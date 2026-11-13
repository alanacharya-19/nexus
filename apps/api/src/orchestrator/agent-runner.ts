import type {
  AgentExecutionState,
  AgentRequestKind,
  ArtifactKind,
  PlanStep,
  ProviderId,
  Run,
  RunAgent,
  RunStage,
} from '@nexus/shared';
import {
  estimateCost,
  estimateTokens,
  MODELS,
  truncate,
} from '@nexus/shared';
import type { ZodType } from 'zod';
import { config } from '../config.js';
import { AppError, Errors } from '../errors.js';
import {
  getAdapterForUser,
  getConfiguredProviders,
  streamWithRetry,
} from '../providers/service.js';
import {
  isAbortError,
  ProviderError,
  type GenerationRequest,
  type ProviderAdapter,
} from '../providers/types.js';
import { generateStructured } from '../orchestration/structured.js';
import type { ExecutionEventEmitter } from './event-emitter.js';
import { ExecutionLimitError } from './cancellation-manager.js';
import type { OrchestratorStore } from './store.js';

export interface Prompt {
  system: string;
  user: string;
}

export interface ProviderResolver {
  getAdapter(userId: string, provider: ProviderId): Promise<ProviderAdapter>;
  getConfiguredProviders(userId: string): Promise<ProviderId[]>;
}

export const defaultProviderResolver: ProviderResolver = {
  getAdapter: getAdapterForUser,
  getConfiguredProviders,
};

export interface AgentOutputDescriptor {
  artifactId: string | null;
  name: string;
  kind: ArtifactKind;
  summary: string;
}

export interface AgentRunInput<T> {
  run: Run;
  agent: RunAgent;
  kind: AgentRequestKind;
  stage: RunStage;
  task: string;
  prompt: Prompt;
  signal: AbortSignal;
  round?: number;
  step?: PlanStep | null;
  schema?: ZodType<T>;
  /** Persist the produced artifact before the completion events are emitted. */
  onOutput?: (result: AgentRunResult<T>) => Promise<AgentOutputDescriptor | null>;
}

export interface AgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  usageSource: 'provider' | 'estimated';
  costEstimated: boolean;
}

export interface AgentRunResult<T = unknown> {
  text: string;
  structured: T | null;
  raw: string;
  usage: AgentRunUsage;
  provider: ProviderId;
  model: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  fallbackUsed: boolean;
}

interface ProviderChoice {
  provider: ProviderId;
  model: string;
}

/**
 * Runs exactly one agent request. Responsibilities are deliberately narrow:
 * resolve a provider, enforce time/budget limits, invoke the model, validate
 * structured output, persist usage and per-agent state, and emit lifecycle
 * events. Artifact creation is supplied by the orchestrator via `onOutput`.
 */
export class AgentRunner {
  constructor(
    private readonly store: OrchestratorStore,
    private readonly events: ExecutionEventEmitter,
    private readonly resolver: ProviderResolver = defaultProviderResolver
  ) {}

  async run<T = unknown>(input: AgentRunInput<T>): Promise<AgentRunResult<T>> {
    const { run, agent } = input;
    this.assertBudget(run);

    const startedAt = new Date().toISOString();
    await this.setState(run, agent, (state) => ({
      ...state,
      status: 'activated',
      currentTask: input.task,
      startedAt: state.startedAt ?? startedAt,
      completedAt: null,
      error: null,
    }));

    await this.events.emit(
      run.id,
      'agent.activated',
      {
        agentId: agent.agentId,
        agentName: agent.name,
        role: agent.role,
        task: input.task,
        stage: input.stage,
        ...(input.round !== undefined ? { round: input.round } : {}),
      },
      { agentId: agent.agentId }
    );
    await this.status(run, agent, input.stage, 'activated', input.task);

    let choice: ProviderChoice = { provider: agent.provider, model: agent.model };
    let fallbackUsed = false;
    let lastError: unknown;

    while (true) {
      this.assertBudget(run);
      let adapter: ProviderAdapter;
      try {
        adapter = await this.resolver.getAdapter(run.userId, choice.provider);
      } catch (error) {
        lastError = error;
        const fallback =
          !fallbackUsed && !input.signal.aborted && !isAbortError(error)
            ? await this.pickFallback(run, choice.provider)
            : null;
        if (fallback) {
          await this.events.emit(
            run.id,
            'agent.fallback',
            {
              agentId: agent.agentId,
              fromProvider: choice.provider,
              fromModel: choice.model,
              toProvider: fallback.provider,
              toModel: fallback.model,
              reason: errorMessage(error),
            },
            { agentId: agent.agentId }
          );
          choice = fallback;
          fallbackUsed = true;
          continue;
        }
        await this.fail(run, agent, input.stage, error);
        throw error;
      }

      await this.events.emit(
        run.id,
        'agent.started',
        {
          agentId: agent.agentId,
          agentName: agent.name,
          role: agent.role,
          model: choice.model,
          provider: choice.provider,
          stage: input.stage,
        },
        { agentId: agent.agentId }
      );
      await this.status(
        run,
        agent,
        input.stage,
        'thinking',
        `Calling ${choice.provider}/${choice.model}`
      );

      this.events.startLive({
        runId: run.id,
        agentId: agent.agentId,
        agentName: agent.name,
        stage: input.stage,
        status: 'thinking',
      });

      const attemptStarted = Date.now();
      try {
        const result = input.schema
          ? await this.runStructured(run, agent, input, adapter, choice)
          : await this.runStreaming(run, agent, input, adapter, choice);

        const latencyMs = Date.now() - attemptStarted;
        const usage = this.usageFor(result, input.prompt, choice.model);
        this.assertAfterUsage(run, usage);

        await this.recordUsage(run, agent, choice, usage, latencyMs, 'success');

        const completedAt = new Date().toISOString();
        const agentResult: AgentRunResult<T> = {
          text: result.text,
          structured: result.structured,
          raw: result.raw,
          usage,
          provider: choice.provider,
          model: choice.model,
          startedAt,
          completedAt,
          latencyMs,
          fallbackUsed,
        };

        const output = input.onOutput
          ? await input.onOutput(agentResult)
          : {
              artifactId: null,
              name: input.task,
              kind: 'document' as ArtifactKind,
              summary: summarize(result.text),
            };

        await this.setState(run, agent, (state) => ({
          ...state,
          status: 'completed',
          currentTask: null,
          completedAt,
          lastOutput: output?.summary ?? summarize(result.text),
          outputs: output
            ? [
                ...state.outputs,
                {
                  artifactId: output.artifactId,
                  name: output.name,
                  kind: output.kind,
                  summary: truncate(output.summary, 2_000),
                  createdAt: completedAt,
                },
              ]
            : state.outputs,
          inputTokens: state.inputTokens + usage.inputTokens,
          outputTokens: state.outputTokens + usage.outputTokens,
          costUsd: state.costUsd + usage.costUsd,
          error: null,
        }));

        await this.events.emit(
          run.id,
          'agent.output',
          {
            agentId: agent.agentId,
            agentName: agent.name,
            role: agent.role,
            stage: input.stage,
            summary: truncate(output?.summary ?? summarize(result.text), 2_000),
            artifactId: output?.artifactId ?? null,
            structured: Boolean(input.schema),
          },
          { agentId: agent.agentId }
        );
        await this.events.emit(
          run.id,
          'agent.completed',
          {
            agentId: agent.agentId,
            summary: truncate(output?.summary ?? summarize(result.text), 500),
            artifactId: output?.artifactId ?? null,
          },
          { agentId: agent.agentId }
        );
        await this.status(run, agent, input.stage, 'completed', output?.summary ?? null);
        this.events.clearLive(run.id);

        return agentResult;
      } catch (error) {
        lastError = error;
        this.events.clearLive(run.id);
        if (
          input.signal.aborted ||
          isAbortError(error) ||
          error instanceof ExecutionLimitError
        ) {
          if (error instanceof ExecutionLimitError) {
            await this.fail(run, agent, input.stage, error);
          }
          throw error;
        }

        await this.recordUsage(
          run,
          agent,
          choice,
          {
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            usageSource: 'estimated',
            costEstimated: true,
          },
          Date.now() - attemptStarted,
          'error'
        );

        if (!fallbackUsed) {
          const fallback = await this.pickFallback(run, choice.provider);
          if (fallback) {
            await this.events.emit(
              run.id,
              'agent.fallback',
              {
                agentId: agent.agentId,
                fromProvider: choice.provider,
                fromModel: choice.model,
                toProvider: fallback.provider,
                toModel: fallback.model,
                reason: errorMessage(error),
              },
              { agentId: agent.agentId }
            );
            choice = fallback;
            fallbackUsed = true;
            continue;
          }
        }

        await this.fail(run, agent, input.stage, error);
        throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Agent execution failed');
  }

  async activate(
    run: Run,
    agent: RunAgent,
    stage: RunStage,
    task: string,
    round?: number
  ): Promise<void> {
    await this.events.emit(
      run.id,
      'agent.activated',
      {
        agentId: agent.agentId,
        agentName: agent.name,
        role: agent.role,
        task,
        stage,
        ...(round !== undefined ? { round } : {}),
      },
      { agentId: agent.agentId }
    );
  }

  async getState(runId: string, agentId: string): Promise<AgentExecutionState | null> {
    const latest = await this.store.getRun(runId);
    return latest?.agentStates[agentId] ?? null;
  }

  private async runStreaming<T>(
    run: Run,
    agent: RunAgent,
    input: AgentRunInput<T>,
    adapter: ProviderAdapter,
    choice: ProviderChoice
  ): Promise<{ text: string; structured: T | null; raw: string; estimatedUsage: boolean; usage: { inputTokens: number; outputTokens: number } }> {
    const request: GenerationRequest = {
      model: choice.model,
      system: input.prompt.system,
      messages: [{ role: 'user', content: input.prompt.user }],
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      signal: input.signal,
    };

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let hasUsage = false;
    let pending = '';
    let lastFlush = Date.now();

    await this.status(run, agent, input.stage, 'working', 'Producing output');

    const flush = (force = false) => {
      if (!pending) return;
      if (!force && pending.length < 120 && Date.now() - lastFlush < 60) return;
      this.events.appendLive(run.id, agent.agentId, pending);
      this.events.publishToken(run.id, agent.agentId, pending);
      pending = '';
      lastFlush = Date.now();
    };

    for await (const event of streamWithRetry(adapter, request, {
      signal: input.signal,
      onRetry: (attempt, error) => {
        console.warn('Retrying provider call', {
          runId: run.id,
          provider: choice.provider,
          attempt,
          message: error.message,
        });
      },
    })) {
      if (event.type === 'delta') {
        text += event.text;
        pending += event.text;
        flush();
      } else if (event.type === 'usage') {
        inputTokens = event.inputTokens;
        outputTokens = event.outputTokens;
        hasUsage = true;
      }
    }
    flush(true);

    if (text.trim().length === 0) {
      throw Errors.aiInvalidOutput('The agent returned an empty response.');
    }

    await this.events.emit(
      run.id,
      'agent.message',
      { agentId: agent.agentId, text: truncate(text, 60_000), stage: input.stage },
      { agentId: agent.agentId }
    );

    return {
      text,
      structured: null,
      raw: text,
      estimatedUsage: !hasUsage,
      usage: { inputTokens, outputTokens },
    };
  }

  private async runStructured<T>(
    run: Run,
    agent: RunAgent,
    input: AgentRunInput<T>,
    adapter: ProviderAdapter,
    choice: ProviderChoice
  ): Promise<{ text: string; structured: T; raw: string; estimatedUsage: boolean; usage: { inputTokens: number; outputTokens: number } }> {
    const request: GenerationRequest = {
      model: choice.model,
      system: input.prompt.system,
      messages: [{ role: 'user', content: input.prompt.user }],
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      signal: input.signal,
    };

    await this.status(run, agent, input.stage, 'working', 'Validating structured output');
    const result = await generateStructured(adapter, request, input.schema!, {
      signal: input.signal,
      timeoutMs: config.providerTimeoutMs,
    });

    await this.events.emit(
      run.id,
      'agent.message',
      {
        agentId: agent.agentId,
        text: truncate(result.raw, 60_000),
        stage: input.stage,
      },
      { agentId: agent.agentId }
    );

    return {
      text: result.raw,
      structured: result.data,
      raw: result.raw,
      estimatedUsage: result.usage.estimatedUsage,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
    };
  }

  private usageFor(
    result: {
      text: string;
      usage: { inputTokens: number; outputTokens: number };
      estimatedUsage: boolean;
    },
    prompt: Prompt,
    model: string
  ): AgentRunUsage {
    const estimated =
      result.estimatedUsage ||
      (result.usage.inputTokens === 0 && result.usage.outputTokens === 0);
    const inputTokens = estimated
      ? estimateTokens(`${prompt.system}\n${prompt.user}`)
      : result.usage.inputTokens;
    const outputTokens = estimated
      ? estimateTokens(result.text)
      : result.usage.outputTokens;
    return {
      inputTokens,
      outputTokens,
      costUsd: estimateCost(model, inputTokens, outputTokens),
      usageSource: estimated ? 'estimated' : 'provider',
      costEstimated: estimated,
    };
  }

  private async recordUsage(
    run: Run,
    agent: RunAgent,
    choice: ProviderChoice,
    usage: AgentRunUsage,
    latencyMs: number,
    status: 'success' | 'error'
  ): Promise<void> {
    await this.store.recordUsage({
      userId: run.userId,
      runId: run.id,
      agentId: agent.agentId,
      agentName: agent.name,
      provider: choice.provider,
      model: choice.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      latencyMs,
      status,
      usageSource: usage.usageSource,
      costEstimated: usage.costEstimated,
    });

    if (status !== 'success') return;
    const totals = await this.store.incrementRunTotals(
      run.id,
      usage.inputTokens + usage.outputTokens,
      usage.costUsd
    );
    await this.events.emit(
      run.id,
      'usage.recorded',
      {
        provider: choice.provider,
        model: choice.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
      },
      { agentId: agent.agentId }
    );
    if (totals) {
      if (totals.totalTokens > run.maxTotalTokens) {
        throw new ExecutionLimitError(
          `Execution exceeded its ${run.maxTotalTokens.toLocaleString()} token limit.`
        );
      }
      if (totals.totalCostUsd > run.maxCostUsd) {
        throw new ExecutionLimitError(
          `Execution exceeded its $${run.maxCostUsd.toFixed(2)} cost limit.`
        );
      }
    }
  }

  private assertBudget(run: Run): void {
    if (run.totalTokens >= run.maxTotalTokens) {
      throw new ExecutionLimitError(
        `Execution reached its ${run.maxTotalTokens.toLocaleString()} token limit.`
      );
    }
    if (run.totalCostUsd >= run.maxCostUsd) {
      throw new ExecutionLimitError(
        `Execution reached its $${run.maxCostUsd.toFixed(2)} cost limit.`
      );
    }
    if (run.executionStartedAt) {
      const elapsed = Date.now() - Date.parse(run.executionStartedAt);
      if (Number.isFinite(elapsed) && elapsed > run.maxDurationMs) {
        throw new ExecutionLimitError(
          `Execution exceeded its ${Math.round(run.maxDurationMs / 1_000)}s limit.`
        );
      }
    }
  }

  private assertAfterUsage(run: Run, usage: AgentRunUsage): void {
    if (run.totalTokens + usage.inputTokens + usage.outputTokens > run.maxTotalTokens) {
      throw new ExecutionLimitError(
        `This call would exceed the ${run.maxTotalTokens.toLocaleString()} token limit.`
      );
    }
    if (run.totalCostUsd + usage.costUsd > run.maxCostUsd) {
      throw new ExecutionLimitError(
        `This call would exceed the $${run.maxCostUsd.toFixed(2)} cost limit.`
      );
    }
  }

  private async pickFallback(run: Run, fromProvider: ProviderId): Promise<ProviderChoice | null> {
    let configured: ProviderId[] = [];
    try {
      configured = await this.resolver.getConfiguredProviders(run.userId);
    } catch {
      return null;
    }
    const candidates = configured.filter((provider) => provider !== fromProvider);
    if (candidates.length === 0) return null;

    const otherAgent = run.agents.find(
      (agent) => agent.provider !== fromProvider && candidates.includes(agent.provider)
    );
    if (otherAgent) return { provider: otherAgent.provider, model: otherAgent.model };

    const provider = candidates[0]!;
    const model =
      MODELS.find((entry) => entry.provider === provider && entry.tier === 'balanced') ??
      MODELS.find((entry) => entry.provider === provider && entry.tier === 'frontier') ??
      MODELS.find((entry) => entry.provider === provider);
    return model ? { provider, model: model.id } : null;
  }

  private async status(
    run: Run,
    agent: RunAgent,
    stage: RunStage,
    status: AgentExecutionState['status'],
    detail: string | null
  ): Promise<void> {
    this.events.setLiveStatus(run.id, status);
    await this.events.emit(
      run.id,
      'agent.status',
      {
        agentId: agent.agentId,
        agentName: agent.name,
        status,
        detail,
        stage,
      },
      { agentId: agent.agentId }
    );
  }

  private async fail(
    run: Run,
    agent: RunAgent,
    stage: RunStage,
    error: unknown
  ): Promise<void> {
    const message = errorMessage(error);
    const code =
      error instanceof AppError
        ? error.code
        : error instanceof ProviderError
          ? 'PROVIDER_FAILED'
          : 'AGENT_FAILED';
    await this.setState(run, agent, (state) => ({
      ...state,
      status: 'failed',
      completedAt: new Date().toISOString(),
      currentTask: null,
      error: truncate(message, 4_000),
    }));
    await this.events.emit(
      run.id,
      'agent.failed',
      { agentId: agent.agentId, message, code },
      { agentId: agent.agentId }
    );
    await this.status(run, agent, stage, 'failed', message);
  }

  private async setState(
    run: Run,
    agent: RunAgent,
    mutate: (state: AgentExecutionState) => AgentExecutionState
  ): Promise<void> {
    const latest = (await this.store.getRun(run.id)) ?? run;
    const previous = latest.agentStates[agent.agentId] ?? this.initialState(agent);
    const next = mutate(previous);
    const agentStates = { ...latest.agentStates, [agent.agentId]: next };
    await this.store.patchRun(run.id, {
      agentStates,
      currentAgentId: agent.agentId,
      currentTask: next.currentTask,
    });
  }

  private initialState(agent: RunAgent): AgentExecutionState {
    return {
      agentId: agent.agentId,
      name: agent.name,
      role: agent.role,
      status: 'idle',
      currentTask: null,
      startedAt: null,
      completedAt: null,
      lastOutput: null,
      outputs: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      error: null,
    };
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'The agent could not complete this task.';
}

function summarize(text: string): string {
  return truncate(text.replace(/[#*`]/g, ' ').replace(/\s+/g, ' ').trim(), 400);
}
