import { afterEach, describe, expect, it } from 'vitest';
import type { Run } from '@nexus/shared';
import {
  createHarness,
  eventsOf,
  makeRun,
  startMockProvider,
  waitFor,
  type MockProvider,
} from './helpers/orchestrator-fixture.js';

const OBJECTIVE = 'Create a detailed business plan for a mobile gaming startup.';

let provider: MockProvider | null = null;

afterEach(async () => {
  await provider?.close();
  provider = null;
});

describe('multi-agent orchestration pipeline', () => {
  it('runs the exact mobile gaming business-plan objective end to end', async () => {
    provider = await startMockProvider();
    const { store, manager } = createHarness(provider);
    const run = store.seed(makeRun({ objective: OBJECTIVE, approvalMode: 'auto' }));

    await manager.start(run.id);
    const completed = await waitFor(
      () => store.getRun(run.id),
      (current): current is Run => current?.executionState === 'completed',
      20_000
    );

    expect(completed.objective).toBe(OBJECTIVE);
    expect(completed.status).toBe('completed');
    expect(completed.executionState).toBe('completed');
    expect(completed.plan?.steps.length).toBeGreaterThanOrEqual(3);
    expect(completed.plan?.steps.every((step) => step.status === 'done')).toBe(true);
    expect(completed.review?.verdict).toBe('approve');
    expect(completed.reviewRound).toBe(1);
    expect(completed.totalTokens).toBeGreaterThan(0);
    expect(completed.totalCostUsd).toBeGreaterThan(0);

    const artifacts = await store.listArtifacts(run.id);
    expect(artifacts.filter((artifact) => artifact.kind !== 'deliverable')).toHaveLength(3);
    const final = artifacts.find((artifact) => artifact.kind === 'deliverable');
    expect(final).toBeDefined();
    expect(final!.content).toContain('Mobile Gaming Startup — Business Plan');
    expect(completed.finalArtifactId).toBe(final!.id);

    const events = eventsOf(store, run.id);
    for (const type of [
      'execution.started',
      'plan.created',
      'agent.activated',
      'agent.output',
      'step.updated',
      'review.started',
      'review.completed',
      'artifact.created',
      'execution.completed',
      'run.completed',
    ] as const) {
      expect(events).toContain(type);
    }

    const providerCalls = provider.requests;
    expect(providerCalls.some((call) => call.system.includes('Planner') && call.json)).toBe(true);
    expect(providerCalls.some((call) => call.system.includes('Worker') && !call.json)).toBe(true);
    expect(providerCalls.some((call) => call.system.includes('Reviewer') && call.json)).toBe(true);
    expect(providerCalls.some((call) => call.system.includes('Polisher') && call.json)).toBe(true);
    expect(store.usage.length).toBeGreaterThanOrEqual(5);
    expect(store.usage.every((record) => record.status === 'success')).toBe(true);
  }, 30_000);

  it('fails the run cleanly when the provider rejects the request', async () => {
    provider = await startMockProvider({ failStatus: 400 });
    const { store, manager } = createHarness(provider);
    const run = store.seed(makeRun({ objective: OBJECTIVE }));

    await manager.start(run.id);
    const failed = await waitFor(
      () => store.getRun(run.id),
      (current): current is Run => current?.executionState === 'failed',
      12_000
    );

    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('PROVIDER_FAILED');
    expect(failed.error).toContain('Mock provider rejected the request.');
    expect(failed.plan).toBeNull();

    const events = eventsOf(store, run.id);
    expect(events).toContain('agent.failed');
    expect(events).toContain('execution.failed');
    expect(events).toContain('run.failed');
    expect(events).not.toContain('execution.completed');
  }, 20_000);

  it('stops an unending review loop at the configured round limit', async () => {
    provider = await startMockProvider({
      reviewVerdicts: ['revise', 'revise', 'approve'],
    });
    const { store, manager } = createHarness(provider);
    const run = store.seed(
      makeRun({ objective: OBJECTIVE, approvalMode: 'auto', maxReviewRounds: 2 })
    );

    await manager.start(run.id);
    const waiting = await waitFor(
      () => store.getRun(run.id),
      (current): current is Run => current?.executionState === 'awaiting_approval',
      20_000
    );

    expect(waiting.reviewRound).toBe(2);
    expect(waiting.pendingApproval?.stage).toBe('review');
    expect(waiting.pendingApproval?.summary).toContain('After 2 rounds');

    const beforeApproval = eventsOf(store, run.id);
    expect(beforeApproval.filter((type) => type === 'review.started')).toHaveLength(2);
    expect(beforeApproval.filter((type) => type === 'revision.requested')).toHaveLength(1);
    expect(
      provider.requests.filter((call) => call.system.includes('Reviewer')).length
    ).toBe(2);

    await manager.approve(run.id, 'approve', null);
    const completed = await waitFor(
      () => store.getRun(run.id),
      (current): current is Run => current?.executionState === 'completed',
      20_000
    );

    expect(completed.status).toBe('completed');
    expect(completed.reviewRound).toBe(2);
    const events = eventsOf(store, run.id);
    expect(events.filter((type) => type === 'review.started')).toHaveLength(2);
    expect(events).toContain('approval.granted');
    expect(events).toContain('execution.completed');
    expect(provider.requests.filter((call) => call.system.includes('Polisher')).length).toBe(1);
  }, 30_000);
});
