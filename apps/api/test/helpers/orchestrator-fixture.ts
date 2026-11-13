import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Run, RunEventType } from '@nexus/shared';
import { createExecutionManager } from '../../src/orchestration/engine.js';
import { OpenAIAdapter } from '../../src/providers/openai.js';
import type { ProviderResolver } from '../../src/orchestrator/agent-runner.js';
import { InMemoryOrchestratorStore } from './in-memory-store.js';

export interface MockProviderOptions {
  /** HTTP status used for every request. A 4xx value fails fast without retries. */
  failStatus?: number;
  reviewVerdicts?: ('approve' | 'revise')[];
  planSteps?: number;
  /** Artificial latency before responding, used to exercise pause/cancel paths. */
  delayMs?: number;
}

interface MockRequest {
  system: string;
  user: string;
  json: boolean;
}

export interface MockProvider {
  baseUrl: string;
  requests: MockRequest[];
  close(): Promise<void>;
}

const PLAN_STEPS = [
  {
    title: 'Market analysis',
    description: 'Analyse the mobile gaming market, audience, and competitors.',
    assigneeRole: 'worker',
    expectedOutput: 'Market analysis section with sourced figures.',
    acceptanceCriteria: ['Names at least three competitors', 'Cites market data'],
    dependsOn: [],
  },
  {
    title: 'Financial model',
    description: 'Build a three-year revenue and cost model.',
    assigneeRole: 'worker',
    expectedOutput: 'Financial projections with assumptions.',
    acceptanceCriteria: ['Shows revenue, costs, and runway'],
    dependsOn: [0],
  },
  {
    title: 'Go-to-market plan',
    description: 'Define launch channels, pricing, and KPIs.',
    assigneeRole: 'worker',
    expectedOutput: 'Launch plan with channel budget.',
    acceptanceCriteria: ['Defines launch KPIs', 'Includes a budget'],
    dependsOn: [0],
  },
];

function planPayload(stepCount: number) {
  return {
    summary: 'Produce a rigorous business plan for a mobile gaming startup.',
    approach:
      'Research the market, model the economics, then assemble an investor-ready narrative.',
    requirements: [
      'Cover market, product, go-to-market, team, and financials.',
      'Provide concrete numbers and explicit assumptions.',
    ],
    constraints: ['Stay within a realistic seed-stage budget.'],
    deliverables: ['Investor-ready business plan'],
    steps: PLAN_STEPS.slice(0, stepCount),
    risks: ['User acquisition costs may rise faster than retention.'],
  };
}

function reviewPayload(verdict: 'approve' | 'revise', round: number) {
  return verdict === 'approve'
    ? {
        verdict,
        score: 91,
        summary: `Round ${round}: the business plan is complete, specific, and internally consistent.`,
        strengths: ['Clear market sizing', 'Credible financial assumptions'],
        issues: [],
        requiredChanges: [],
        contradictions: [],
        missingRequirements: [],
      }
    : {
        verdict,
        score: 64,
        summary: `Round ${round}: the plan needs more evidence and tighter financial assumptions.`,
        strengths: ['Good structure'],
        issues: [
          {
            severity: 'high',
            area: 'Financial model',
            description: 'The revenue assumptions are not tied to retention.',
            suggestion: 'Link revenue to D30 retention and paying-user conversion.',
          },
        ],
        requiredChanges: ['Tie revenue assumptions to retention and conversion.'],
        contradictions: [],
        missingRequirements: ['Explicit retention assumptions'],
      };
}

function finalPayload() {
  return {
    title: 'Mobile Gaming Startup — Business Plan',
    content: `# Mobile Gaming Startup — Business Plan

## Executive summary
NEXUS Games will launch a mid-core mobile strategy title for players aged 18–34, monetised through a battle pass and cosmetic purchases. The plan targets a seed round of $2.5M to reach a validated soft launch and 250,000 monthly active players.

## Market
The mobile gaming market continues to grow, with mid-core strategy titles retaining players longer than hyper-casual games. We will benchmark retention, ARPDAU, and user-acquisition costs against three comparable studios.

## Product
The first title, **Signal Front**, ships a 12-week seasonal cadence with cooperative guild play and a transparent battle pass.

## Financial plan
The model ties revenue to D30 retention, paying-user conversion, and ARPDAU. Base case: 250,000 MAU, 4.2% conversion, $0.38 ARPDAU. The $2.5M seed round funds 18 months of operations with a six-month buffer.

## Go-to-market
Launch through creator partnerships, a soft launch in Canada and Australia, and paid social experiments capped at a $40 CPI target. KPIs: D7 retention ≥ 22%, D30 ≥ 9%, payback ≤ 120 days.

## Team and hiring
The founding team combines live-ops, engineering, and growth experience. The seed round funds eight additional roles across art, backend, and marketing.

## Risks
User-acquisition costs and platform policy changes are the primary risks. We mitigate them with organic creator content, diversified channels, and a staged marketing budget.
`,
    summary:
      'A seed-stage business plan for a mid-core mobile strategy studio, including market, product, economics, launch, hiring, and risks.',
    sources: ['Market analysis', 'Financial model', 'Go-to-market plan'],
    unresolvedIssues: [],
  };
}

export async function startMockProvider(
  options: MockProviderOptions = {}
): Promise<MockProvider> {
  const requests: MockRequest[] = [];
  let reviewIndex = 0;

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST' || !request.url?.includes('/v1/chat/completions')) {
      response.writeHead(404).end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      messages: { role: string; content: string }[];
      response_format?: { type: string };
    };
    const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
    const user = body.messages.find((message) => message.role === 'user')?.content ?? '';
    const json = Boolean(body.response_format);
    requests.push({ system, user, json });

    if (options.failStatus) {
      response.writeHead(options.failStatus, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ error: { message: 'Mock provider rejected the request.' } })
      );
      return;
    }

    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (response.destroyed) return;
    }

    let content: string;
    if (system.includes('Planner')) {
      content = JSON.stringify(planPayload(options.planSteps ?? 3));
    } else if (system.includes('Reviewer')) {
      const verdict = options.reviewVerdicts?.[reviewIndex] ?? 'approve';
      reviewIndex += 1;
      content = JSON.stringify(
        reviewPayload(verdict, Math.max(1, reviewIndex))
      );
    } else if (system.includes('Polisher')) {
      content = JSON.stringify(finalPayload());
    } else {
      content = `# ${user.includes('CURRENT STEP') ? 'Deliverable' : 'Worker output'}\n\nThis section contains concrete analysis, assumptions, and recommendations for the business plan.\n\n- Market evidence\n- Financial assumptions\n- Operational next steps\n`;
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.write(
      `data: ${JSON.stringify({
        choices: [{ delta: { content }, finish_reason: null }],
      })}\n\n`
    );
    response.write(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 80 },
      })}\n\n`
    );
    response.write('data: [DONE]\n\n');
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

export function makeRun(input: {
  objective: string;
  approvalMode?: Run['approvalMode'];
  maxReviewRounds?: number;
  maxDurationMs?: number;
}): Run {
  const now = new Date().toISOString();
  const agent = (role: 'planner' | 'worker' | 'reviewer' | 'polisher') => ({
    agentId: randomUUID(),
    name: `${role[0]!.toUpperCase()}${role.slice(1)}`,
    role,
    provider: 'openai' as const,
    model: 'gpt-4.1',
    systemPrompt: `You are ${role[0]!.toUpperCase()}${role.slice(1)}, a specialist agent for NEXUS.`,
    temperature: 0.2,
    maxTokens: 4_096,
    accent: '#A8C7FA',
  });

  return {
    id: randomUUID(),
    userId: randomUUID(),
    projectId: null,
    projectName: null,
    title: 'Mobile gaming business plan',
    objective: input.objective,
    templateId: null,
    status: 'queued',
    stage: 'plan',
    executionState: 'queued',
    approvalMode: input.approvalMode ?? 'auto',
    agents: [agent('planner'), agent('worker'), agent('reviewer'), agent('polisher')],
    plan: null,
    review: null,
    pendingApproval: null,
    currentStep: 0,
    reviewRound: 0,
    revisionCount: 0,
    maxReviewRounds: input.maxReviewRounds ?? 3,
    maxDurationMs: input.maxDurationMs ?? 60_000,
    maxTotalTokens: 500_000,
    maxCostUsd: 3,
    currentAgentId: null,
    currentTask: null,
    agentStates: {},
    error: null,
    errorCode: null,
    totalTokens: 0,
    totalCostUsd: 0,
    finalArtifactId: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    executionStartedAt: null,
    completedAt: null,
  };
}

export function resolverFor(provider: MockProvider): ProviderResolver {
  return {
    getAdapter: async (_userId, providerId) => {
      if (providerId !== 'openai') throw new Error(`Provider ${providerId} is not configured`);
      return new OpenAIAdapter('test-key', provider.baseUrl);
    },
    getConfiguredProviders: async () => ['openai'],
  };
}

export function eventsOf(store: InMemoryOrchestratorStore, runId: string): RunEventType[] {
  return store.types(runId);
}

export async function waitFor<T>(
  read: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  timeoutMs = 12_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    const value = await read();
    last = value;
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for orchestration state: ${JSON.stringify(last)}`);
}

export function createHarness(provider: MockProvider) {
  const store = new InMemoryOrchestratorStore();
  const manager = createExecutionManager(store, resolverFor(provider));
  return { store, manager };
}
