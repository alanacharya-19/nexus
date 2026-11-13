import type {
  AgentRole,
  Artifact,
  ArtifactKind,
  PlanStep,
  PolisherOutput,
  ProviderId,
  ReviewOutput,
  Run,
  RunAgent,
  RunPlan,
  RunReview,
  RunStage,
} from '@nexus/shared';
import {
  finalDeliverableSchema,
  polisherOutputSchema,
  reviewOutputSchema,
  truncate,
} from '@nexus/shared';
import { config } from '../config.js';
import { AppError, Errors } from '../errors.js';
import { isAbortError, ProviderError } from '../providers/types.js';
import {
  buildPolisherPrompt,
  buildReviewPrompt,
  buildRevisionPrompt,
  buildWorkerPrompt,
} from '../orchestration/prompts.js';
import type { AgentRunResult, AgentOutputDescriptor } from './agent-runner.js';
import { AgentRunner } from './agent-runner.js';
import type { ApprovalManager } from './approval-manager.js';
import {
  CancellationManager,
  ExecutionLimitError,
  type RunControl,
} from './cancellation-manager.js';
import type { ContextManager } from './context-manager.js';
import type { ExecutionEventEmitter } from './event-emitter.js';
import { isTerminalState, StateManager } from './state-manager.js';
import type { OrchestratorStore } from './store.js';
import type { TaskPlanner } from './task-planner.js';
import type { RetryManager } from './retry-manager.js';

const MAX_STEP_ATTEMPTS = 2;

export interface OrchestratorDeps {
  store: OrchestratorStore;
  events: ExecutionEventEmitter;
  states: StateManager;
  approvals: ApprovalManager;
  planner: TaskPlanner;
  runner: AgentRunner;
  context: ContextManager;
  retry: RetryManager;
  cancellation: CancellationManager;
}

/**
 * The pipeline state machine:
 *
 * USER → PLANNER → PLAN → WORKER → REVIEWER → revision? → WORKER REVISION
 *      → REVIEWER → ... → POLISHER → FINAL RESULT
 *
 * Every transition is validated and persisted. Agent outputs must come back
 * through Zod before they can influence control flow.
 */
export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async execute(runId: string): Promise<void> {
    let control =
      this.deps.cancellation.get(runId) ?? this.deps.cancellation.create(runId);

    while (true) {
      const latestControl = this.deps.cancellation.get(runId);
      if (latestControl) control = latestControl;
      const mode = this.deps.cancellation.mode(runId);
      if (mode === 'pause' || mode === 'cancel') return;
      if (mode === 'steer') {
        await this.resetInProgress(runId);
        this.deps.cancellation.reset(runId);
      }

      const run = await this.deps.store.getRun(runId);
      if (!run) return;
      if (isTerminalState(run.executionState)) return;
      if (
        run.executionState === 'paused' ||
        run.executionState === 'awaiting_approval' ||
        run.executionState === 'queued'
      ) {
        return;
      }

      try {
        this.assertBudget(run);
        const advanced = await this.runState(run, control);
        if (!advanced) return;
      } catch (error) {
        const currentMode = this.deps.cancellation.mode(runId);
        if (currentMode === 'steer') {
          await this.resetInProgress(runId);
          this.deps.cancellation.reset(runId);
          continue;
        }
        if (
          currentMode === 'pause' ||
          currentMode === 'cancel' ||
          isAbortError(error) ||
          error instanceof ExecutionLimitError
        ) {
          if (error instanceof ExecutionLimitError) {
            await this.failRun(run, error);
          }
          return;
        }
        await this.failRun(run, error);
        return;
      }
    }
  }

  private async runState(run: Run, control: RunControl): Promise<boolean> {
    switch (run.executionState) {
      case 'planning':
        return this.handlePlan(run, control);
      case 'executing':
        return this.handleWork(run, control);
      case 'reviewing':
        return this.handleReview(run, control);
      case 'revising':
        return this.handleRevise(run, control);
      case 'polishing':
        return this.handlePolish(run, control);
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------
  // Planner
  // -------------------------------------------------------------------------

  private async handlePlan(run: Run, control: RunControl): Promise<boolean> {
    if (run.plan) {
      await this.deps.states.transition(run, 'executing');
      return true;
    }

    const result = await this.deps.planner.createPlan({
      run,
      signal: control.abort.signal,
    });

    const latest = (await this.deps.store.getRun(run.id)) ?? run;
    await this.deps.store.patchRun(run.id, { plan: result.runPlan });
    await this.deps.events.emit(
      run.id,
      'plan.created',
      { plan: result.runPlan },
      { agentId: result.agent.agentId }
    );
    await this.deps.store.consumeInstructions(run.id);

    const withPlan = { ...latest, plan: result.runPlan };
    if (this.deps.approvals.shouldRequest(withPlan, 'plan')) {
      await this.deps.approvals.request(
        withPlan,
        'plan',
        'Approve the execution plan',
        result.plan.summary
      );
      return false;
    }

    await this.deps.states.transition(withPlan, 'executing');
    return true;
  }

  // -------------------------------------------------------------------------
  // Worker
  // -------------------------------------------------------------------------

  private async handleWork(run: Run, control: RunControl): Promise<boolean> {
    if (!run.plan) throw Errors.invalidState('Run has no plan to execute.');

    const plan: RunPlan = {
      ...run.plan,
      steps: run.plan.steps.map((step) => ({ ...step })),
    };
    let index = run.currentStep;

    while (index < plan.steps.length) {
      this.assertBudget(run);
      if (this.deps.cancellation.isCancelledOrPaused(run.id)) return false;

      const step = plan.steps[index]!;
      if (step.status === 'done') {
        index += 1;
        continue;
      }

      const claim = this.deps.retry.claimAttempt(step, MAX_STEP_ATTEMPTS);
      if (!claim.allowed) {
        await this.updateStep(run.id, plan, index, {
          status: 'failed',
          attempts: claim.attempts,
        });
        throw Errors.invalidState(
          `Step "${step.title}" failed after ${claim.attempts} attempts.`
        );
      }

      const agent = this.pickAgent(run, step.assigneeRole, step.assignedAgentId ?? null);
      const produced: Artifact[] = [];
      const runningStep: PlanStep = {
        ...step,
        status: 'running',
        attempts: claim.attempts,
      };
      plan.steps[index] = runningStep;
      await this.deps.store.patchRun(run.id, { plan, currentStep: index });
      await this.deps.events.emit(run.id, 'step.updated', {
        step: runningStep,
        index,
      });

      try {
        const context = await this.deps.context.build({
          run,
          step: runningStep,
          task: runningStep.title,
          artifactBudgetChars: 28_000,
        });
        const prompt = buildWorkerPrompt({
          run: { ...run, plan },
          step: runningStep,
          stepIndex: index,
          artifacts: context.artifacts,
          instructions: context.instructions,
          context,
        });

        await this.deps.runner.run({
          run,
          agent,
          kind: 'execute',
          stage: 'work',
          task: runningStep.title,
          prompt,
          signal: control.abort.signal,
          step: runningStep,
          onOutput: async (output) => {
            const created = await this.persistArtifact(
              run,
              runningStep,
              agent,
              output.text
            );
            produced.push(created);
            return this.descriptor(created);
          },
        });

        const artifact = produced[0];
        if (!artifact) {
          throw Errors.invalidState('The worker completed without producing an artifact.');
        }

        plan.steps[index] = {
          ...runningStep,
          status: 'done',
          outputArtifactId: artifact.id,
        };
        await this.deps.store.patchRun(run.id, { plan, currentStep: index + 1 });
        await this.deps.events.emit(run.id, 'step.updated', {
          step: plan.steps[index]!,
          index,
        });
        await this.deps.store.consumeInstructions(run.id);
        index += 1;
      } catch (error) {
        const completedArtifact = produced[0];
        const structured = completedArtifact
          ? {
              ...runningStep,
              status: 'done' as const,
              outputArtifactId: completedArtifact.id,
            }
          : { ...runningStep, status: 'pending' as const };
        plan.steps[index] = structured;
        await this.deps.store.patchRun(run.id, { plan, currentStep: index });
        await this.deps.events.emit(run.id, 'step.updated', {
          step: structured,
          index,
        });

        if (
          this.deps.cancellation.isCancelledOrPaused(run.id) ||
          isAbortError(error)
        ) {
          return false;
        }

        if (this.deps.retry.canRetry(error, { attempts: claim.attempts }, MAX_STEP_ATTEMPTS)) {
          await this.deps.events.emit(run.id, 'agent.status', {
            agentId: agent.agentId,
            agentName: agent.name,
            status: 'thinking',
            detail: `Retrying step after ${claim.attempts} failed attempt(s)`,
            stage: 'work',
          });
          await new Promise((resolve) =>
            setTimeout(resolve, this.deps.retry.delayFor(claim.attempts))
          );
          continue;
        }

        throw error;
      }
    }

    const latest = (await this.deps.store.getRun(run.id)) ?? run;
    if (this.deps.approvals.shouldRequest(latest, 'work')) {
      await this.deps.approvals.request(
        latest,
        'work',
        'Review the deliverables before audit',
        `${plan.steps.length} deliverables are ready. Approve to send them to the reviewer.`
      );
      return false;
    }

    await this.deps.states.transition(latest, 'reviewing', {
      plan,
      currentStep: plan.steps.length,
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Reviewer
  // -------------------------------------------------------------------------

  private async handleReview(run: Run, control: RunControl): Promise<boolean> {
    const artifacts = await this.deps.store.listArtifacts(run.id);
    if (artifacts.length === 0) {
      throw Errors.invalidState('There are no deliverables to review.');
    }

    const reviewer = this.pickAgent(run, 'reviewer', null);
    const context = await this.deps.context.build({
      run,
      task: 'Review the worker outputs against the objective and plan.',
      budgetChars: 52_000,
      artifactBudgetChars: 38_000,
    });
    const prompt = buildReviewPrompt({
      run,
      artifacts: context.artifacts,
      instructions: context.instructions,
      context,
    });
    const round = run.reviewRound + 1;

    await this.deps.events.emit(
      run.id,
      'review.started',
      {
        agentId: reviewer.agentId,
        agentName: reviewer.name,
        round,
        artifactCount: context.artifacts.length,
      },
      { agentId: reviewer.agentId }
    );

    const result = await this.deps.runner.run<ReviewOutput>({
      run,
      agent: reviewer,
      kind: 'review',
      stage: 'review',
      task: `Review round ${round}`,
      prompt,
      signal: control.abort.signal,
      round,
      schema: reviewOutputSchema,
    });

    if (!result.structured) {
      throw Errors.aiInvalidOutput('The reviewer did not return structured output.');
    }

    const review: RunReview = {
      verdict: result.structured.verdict,
      score: result.structured.score,
      summary: result.structured.summary,
      strengths: result.structured.strengths,
      issues: result.structured.issues,
      requiredChanges: result.structured.requiredChanges,
      contradictions: result.structured.contradictions,
      missingRequirements: result.structured.missingRequirements,
      reviewedArtifactIds: context.artifacts.map((artifact) => artifact.id),
      round,
      createdAt: new Date().toISOString(),
    };

    await this.deps.store.patchRun(run.id, { review, reviewRound: round });
    await this.deps.store.consumeInstructions(run.id);
    await this.deps.events.emit(run.id, 'review.completed', { review });

    const latest = (await this.deps.store.getRun(run.id)) ?? { ...run, review, reviewRound: round };

    if (review.verdict === 'revise') {
      const worker = run.agents.find((agent) => agent.role === 'worker');
      if (round < run.maxReviewRounds) {
        const instructions =
          review.requiredChanges.length > 0
            ? review.requiredChanges
            : review.issues.map((issue) => `${issue.area}: ${issue.suggestion}`);
        await this.deps.events.emit(run.id, 'revision.requested', {
          agentId: worker?.agentId ?? reviewer.agentId,
          round,
          instructions,
          review,
        });
        if (worker) {
          await this.deps.events.emit(run.id, 'agent.handoff', {
            fromAgentId: reviewer.agentId,
            toAgentId: worker.agentId,
            reason: `Review round ${round} requires revision`,
          });
        }
        await this.deps.states.transition(latest, 'revising', { currentStep: 0 });
        return true;
      }

      await this.deps.approvals.request(
        latest,
        'review',
        'Reviewer still has concerns',
        `After ${round} rounds the reviewer scored this ${review.score}/100. Approve to polish anyway, or reject with guidance to revise.`
      );
      return false;
    }

    await this.deps.events.emit(run.id, 'approval.granted', {
      stage: 'review',
      title: 'Reviewer approved the deliverables',
      note: review.summary,
    });

    if (this.deps.approvals.shouldRequest(latest, 'review')) {
      await this.deps.approvals.request(
        latest,
        'review',
        'Review passed — approve polish',
        `Score ${review.score}/100. ${review.summary}`
      );
      return false;
    }

    await this.deps.states.transition(latest, 'polishing');
    return true;
  }

  // -------------------------------------------------------------------------
  // Revision
  // -------------------------------------------------------------------------

  private async handleRevise(run: Run, control: RunControl): Promise<boolean> {
    if (!run.review) {
      throw Errors.invalidState('There is no review feedback to revise against.');
    }

    const worker = this.pickAgent(run, 'worker', null);
    const context = await this.deps.context.build({
      run,
      task: `Apply reviewer feedback for round ${run.review.round}.`,
      review: run.review.summary,
      budgetChars: 44_000,
      artifactBudgetChars: 30_000,
    });
    const prompt = buildRevisionPrompt({
      run,
      review: run.review,
      artifacts: context.artifacts,
      instructions: context.instructions,
      context,
    });

    const produced: Artifact[] = [];
    await this.deps.runner.run({
      run,
      agent: worker,
      kind: 'revise',
      stage: 'revise',
      task: `Revision ${run.revisionCount + 1}`,
      prompt,
      signal: control.abort.signal,
      round: run.review.round,
      onOutput: async (output) => {
        const created = await this.persistArtifact(
          run,
          null,
          worker,
          output.text,
          `Revision ${run.revisionCount + 1} — ${run.title}`,
          'document'
        );
        produced.push(created);
        return this.descriptor(created);
      },
    });

    if (!produced[0]) {
      throw Errors.invalidState('The revision produced no artifact.');
    }

    const latest = (await this.deps.store.getRun(run.id)) ?? run;
    await this.deps.store.patchRun(run.id, {
      revisionCount: latest.revisionCount + 1,
      currentStep: 0,
    });
    await this.deps.store.consumeInstructions(run.id);
    await this.deps.states.transition(
      { ...latest, revisionCount: latest.revisionCount + 1, currentStep: 0 },
      'reviewing'
    );
    return true;
  }

  // -------------------------------------------------------------------------
  // Polisher
  // -------------------------------------------------------------------------

  private async handlePolish(run: Run, control: RunControl): Promise<boolean> {
    const polisher = this.pickAgent(run, 'polisher', null);
    const context = await this.deps.context.build({
      run,
      task: 'Prepare the definitive final deliverable.',
      review: run.review?.summary ?? null,
      budgetChars: 56_000,
      artifactBudgetChars: 42_000,
    });
    const prompt = buildPolisherPrompt({
      run,
      artifacts: context.artifacts,
      review: run.review,
      instructions: context.instructions,
      context,
    });

    const produced: Artifact[] = [];
    const result = await this.deps.runner.run<PolisherOutput>({
      run,
      agent: polisher,
      kind: 'polish',
      stage: 'polish',
      task: 'Produce the final deliverable',
      prompt,
      signal: control.abort.signal,
      schema: polisherOutputSchema,
      onOutput: async (output) => {
        const structured = output.structured;
        if (!structured) {
          throw Errors.aiInvalidOutput('The polisher returned no validated deliverable.');
        }
        // Timestamp and review score are server-owned: never trust the model
        // to invent provenance metadata.
        const deliverable = finalDeliverableSchema.parse({
          ...structured,
          reviewScore: run.review?.score ?? null,
          createdAt: new Date().toISOString(),
        });
        const created = await this.persistArtifact(
          run,
          null,
          polisher,
          deliverable.content,
          deliverable.title,
          'deliverable'
        );
        produced.push(created);
        await this.deps.store.patchRun(run.id, { finalArtifactId: created.id });
        return {
          ...this.descriptor(created),
          summary: deliverable.summary,
        };
      },
    });

    const artifact = produced[0];
    if (!artifact || !result.structured) {
      throw Errors.invalidState('The polish stage produced no final deliverable.');
    }

    await this.deps.store.consumeInstructions(run.id);
    const latest = (await this.deps.store.getRun(run.id)) ?? run;
    const completedRun = {
      ...latest,
      finalArtifactId: artifact.id,
    };

    if (this.deps.approvals.shouldRequest(completedRun, 'polish')) {
      await this.deps.approvals.request(
        completedRun,
        'polish',
        'Approve the final deliverable',
        'The polished deliverable is ready. Approve to complete this run.'
      );
      return false;
    }

    const finished = await this.deps.states.transition(completedRun, 'completed', {
      finalArtifactId: artifact.id,
      currentTask: null,
    });
    await this.announceCompletion(finished);
    return false;
  }

  // -------------------------------------------------------------------------
  // Completion and failure
  // -------------------------------------------------------------------------

  async announceCompletion(run: Run): Promise<void> {
    const latest = (await this.deps.store.getRun(run.id)) ?? run;
    const durationMs = latest.executionStartedAt
      ? Math.max(0, Date.now() - Date.parse(latest.executionStartedAt))
      : 0;
    await this.deps.events.emit(
      latest.id,
      'execution.completed',
      {
        state: 'completed',
        finalArtifactId: latest.finalArtifactId,
        durationMs,
        totalTokens: latest.totalTokens,
        totalCostUsd: latest.totalCostUsd,
      },
      { key: `${latest.id}:execution-completed` }
    );
    await this.deps.events.emit(
      latest.id,
      'run.completed',
      { finalArtifactId: latest.finalArtifactId },
      { key: `${latest.id}:run-completed` }
    );
  }

  private async failRun(run: Run, error: unknown): Promise<void> {
    const current = (await this.deps.store.getRun(run.id)) ?? run;
    if (current.executionState === 'failed' || current.executionState === 'completed') {
      return;
    }
    if (current.executionState === 'cancelled' || current.executionState === 'paused') {
      return;
    }

    const code =
      error instanceof AppError
        ? error.code
        : error instanceof ProviderError
          ? 'PROVIDER_FAILED'
          : 'RUN_FAILED';
    const message =
      error instanceof Error
        ? error.message
        : 'The run failed unexpectedly. Retry the stage or check the agent configuration.';

    const failed = await this.deps.states.transition(current, 'failed', {
      error: message,
      errorCode: code,
      pendingApproval: null,
      currentTask: null,
    });
    await this.deps.events.emit(
      failed.id,
      'execution.failed',
      { state: 'failed', message, code },
      { key: `${failed.id}:execution-failed` }
    );
    await this.deps.events.emit(
      failed.id,
      'run.failed',
      { message, code },
      { key: `${failed.id}:run-failed` }
    );
    this.deps.events.clearLive(failed.id);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async persistArtifact(
    run: Run,
    step: PlanStep | null,
    agent: RunAgent,
    content: string,
    name?: string,
    kind?: ArtifactKind
  ): Promise<Artifact> {
    const resolvedKind = kind ?? this.detectArtifactKind(step, content);
    const version =
      (await this.deps.store.countArtifactVersions(run.id, resolvedKind, step?.id ?? null)) + 1;
    const artifact = await this.deps.store.createArtifact({
      runId: run.id,
      userId: run.userId,
      name: name || step?.title || 'Artifact',
      kind: resolvedKind,
      mimeType: resolvedKind === 'code' ? 'text/x-code' : 'text/markdown',
      content,
      version,
      createdByAgentId: agent.agentId,
      agentName: agent.name,
      stepId: step?.id ?? null,
    });
    await this.deps.events.emit(run.id, 'artifact.created', {
      artifactId: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      version: artifact.version,
    });
    return artifact;
  }

  private descriptor(artifact: Artifact): AgentOutputDescriptor {
    return {
      artifactId: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      summary: truncate(artifact.content.replace(/[#*`]/g, ' ').replace(/\s+/g, ' ').trim(), 400),
    };
  }

  private async updateStep(
    runId: string,
    plan: RunPlan,
    index: number,
    patch: Partial<PlanStep>
  ): Promise<void> {
    const step = { ...plan.steps[index]!, ...patch };
    plan.steps[index] = step;
    await this.deps.store.patchRun(runId, { plan });
    await this.deps.events.emit(runId, 'step.updated', { step, index });
  }

  private detectArtifactKind(step: PlanStep | null, text: string): ArtifactKind {
    if (!step) return 'document';
    const hasCode = /```[\s\S]*?```/.test(text);
    const codeIntent =
      /code|implement|script|component|schema|query|function|class|api|typescript|python/i.test(
        `${step.title} ${step.expectedOutput} ${step.description}`
      );
    return hasCode && codeIntent ? 'code' : 'document';
  }

  private pickAgent(
    run: Run,
    role: AgentRole | string,
    assignedAgentId: string | null
  ): RunAgent {
    if (assignedAgentId) {
      const assigned = run.agents.find((agent) => agent.agentId === assignedAgentId);
      if (assigned) return assigned;
    }
    const exact = run.agents.find((agent) => agent.role === role);
    if (exact) return exact;
    const fallback =
      run.agents.find((agent) => agent.role === 'worker') ?? run.agents[0];
    if (!fallback) {
      throw Errors.invalidState(`This run has no ${role} agent configured.`);
    }
    return fallback;
  }

  private async resetInProgress(runId: string): Promise<void> {
    const run = await this.deps.store.getRun(runId);
    if (!run?.plan) return;
    let changed = false;
    const steps = run.plan.steps.map((step) => {
      if (step.status === 'running') {
        changed = true;
        return { ...step, status: 'pending' as const };
      }
      return step;
    });
    if (!changed) return;
    const plan = { ...run.plan, steps };
    await this.deps.store.patchRun(runId, { plan });
    for (let index = 0; index < steps.length; index += 1) {
      if (steps[index]!.status === 'pending') {
        await this.deps.events.emit(runId, 'step.updated', { step: steps[index]!, index });
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
}

export function defaultExecutionLimits() {
  return {
    maxReviewRounds: config.maxReviewRounds,
    maxDurationMs: config.maxExecutionDurationMs,
    maxTotalTokens: config.maxExecutionTokens,
    maxCostUsd: config.maxExecutionCostUsd,
  };
}

export type { AgentRunResult };
export type { ProviderId, RunStage };
