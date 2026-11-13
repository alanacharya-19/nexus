import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Artifact, Run } from '@nexus/shared';
import { Errors } from '../src/errors.js';
import { createExecutionManager } from '../src/orchestration/engine.js';
import { ContextManager } from '../src/orchestrator/context-manager.js';
import {
  CancellationManager,
  ExecutionLimitError,
} from '../src/orchestrator/cancellation-manager.js';
import { ExecutionEventEmitter } from '../src/orchestrator/event-emitter.js';
import { RetryManager } from '../src/orchestrator/retry-manager.js';
import { StateManager } from '../src/orchestrator/state-manager.js';
import { InMemoryOrchestratorStore } from './helpers/in-memory-store.js';
import {
  createHarness,
  makeRun,
  startMockProvider,
  waitFor,
  type MockProvider,
} from './helpers/orchestrator-fixture.js';

let provider: MockProvider | null = null;

afterEach(async () => {
  await provider?.close();
  provider = null;
});

function core(store = new InMemoryOrchestratorStore()) {
  const events = new ExecutionEventEmitter(store);
  const states = new StateManager(store, events);
  return { store, events, states };
}

describe('execution state machine', () => {
  it('persists a valid transition and emits the previous and next state', async () => {
    const { store, events, states } = core();
    const run = store.seed(makeRun({ objective: 'Draft a launch plan for the product.' }));

    const updated = await states.transition(run, 'planning');

    expect(updated.executionState).toBe('planning');
    expect(updated.status).toBe('running');
    expect(updated.stage).toBe('plan');
    expect(updated.startedAt).not.toBeNull();

    const stateEvent = (await store.listEvents(run.id)).find(
      (event) => event.type === 'execution.state'
    );
    expect(stateEvent?.payload).toMatchObject({
      state: 'planning',
      previous: 'queued',
      stage: 'plan',
      status: 'running',
    });
    expect(events.getLive(run.id)).toBeNull();
  });

  it('rejects impossible transitions before writing', async () => {
    const { store, states } = core();
    const run = store.seed(makeRun({ objective: 'Draft a launch plan for the product.' }));
    const completed = await states.transition(run, 'planning');
    const executing = await states.transition(completed, 'executing');
    const reviewing = await states.transition(executing, 'reviewing');
    const polishing = await states.transition(reviewing, 'polishing');
    const finished = await states.transition(polishing, 'completed');

    await expect(states.transition(finished, 'planning')).rejects.toThrow(
      /cannot move from "completed" to "planning"/i
    );
    expect((await store.getRun(run.id))?.executionState).toBe('completed');
  });

  it('allows a paused run to resume or finish and a cancelled run to retry', async () => {
    const { store, states } = core();
    const run = store.seed(makeRun({ objective: 'Draft a launch plan for the product.' }));
    const paused = await states.transition(run, 'paused');

    await expect(states.transition(paused, 'planning')).resolves.toMatchObject({
      executionState: 'planning',
    });

    const cancelled = await states.transition(paused, 'cancelled');
    await expect(states.transition(cancelled, 'executing')).resolves.toMatchObject({
      executionState: 'executing',
    });
  });
});

describe('reliability controls', () => {
  it('never reruns a completed step and bounds pending attempts', () => {
    const retry = new RetryManager(2, 1);

    expect(retry.claimAttempt({ status: 'done', attempts: 1 }, 2)).toEqual({
      allowed: false,
      attempts: 1,
    });
    expect(retry.claimAttempt({ status: 'pending', attempts: 0 }, 2)).toEqual({
      allowed: true,
      attempts: 1,
    });
    expect(retry.claimAttempt({ status: 'pending', attempts: 2 }, 2)).toEqual({
      allowed: false,
      attempts: 3,
    });
  });

  it('retries transient failures only up to the configured ceiling', async () => {
    const retry = new RetryManager(3, 1);
    let calls = 0;
    const value = await retry.execute(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('socket reset');
        return 'ok';
      },
      { attempts: 3 }
    );

    expect(value).toBe('ok');
    expect(calls).toBe(3);

    let failures = 0;
    await expect(
      retry.execute(
        async () => {
          failures += 1;
          throw new Error('still unavailable');
        },
        { attempts: 2 }
      )
    ).rejects.toThrow('still unavailable');
    expect(failures).toBe(2);
  });

  it('does not retry non-retryable validation failures', async () => {
    const retry = new RetryManager(3, 1);
    let calls = 0;

    await expect(
      retry.execute(async () => {
        calls += 1;
        throw Errors.aiInvalidOutput('Malformed structured output.');
      })
    ).rejects.toThrow('Malformed structured output.');
    expect(calls).toBe(1);
    expect(
      retry.canRetry(Errors.aiInvalidOutput('Malformed structured output.'), { attempts: 1 }, 3)
    ).toBe(false);
  });

  it('aborts the active provider signal on pause or cancel', () => {
    const cancellation = new CancellationManager();
    const paused = cancellation.create('run-pause');
    cancellation.pause('run-pause');
    expect(paused.abort.signal.aborted).toBe(true);
    expect(cancellation.isCancelledOrPaused('run-pause')).toBe(true);

    const cancelled = cancellation.create('run-cancel');
    cancellation.cancel('run-cancel');
    expect(cancelled.abort.signal.aborted).toBe(true);
    expect(cancellation.mode('run-cancel')).toBe('cancel');

    const steered = cancellation.create('run-steer');
    cancellation.steer('run-steer');
    expect(steered.abort.signal.aborted).toBe(true);
    expect(cancellation.isCancelledOrPaused('run-steer')).toBe(false);
    expect(cancellation.reset('run-steer')?.abort.signal.aborted).toBe(false);
  });

  it('enforces a hard execution duration ceiling', () => {
    const run = makeRun({ objective: 'Draft a launch plan for the product.' });
    const cancellation = new CancellationManager();
    const startedAt = Date.now() - 60_000;
    const past = { ...run, executionStartedAt: new Date(startedAt).toISOString(), maxDurationMs: 1_000 };

    expect(() => cancellation.assertWithinDuration(past, startedAt + 500)).not.toThrow();
    expect(() => cancellation.assertWithinDuration(past, startedAt + 2_000)).toThrow(
      ExecutionLimitError
    );
  });

  it('deduplicates checkpoint events by key without blocking legitimate repeats', async () => {
    const { store, events } = core();
    const run = store.seed(makeRun({ objective: 'Draft a launch plan for the product.' }));

    await events.emit(run.id, 'execution.started', {
      state: 'planning',
      objective: run.objective,
      pipeline: ['planner', 'worker', 'reviewer', 'polisher'],
    });
    await events.emit(
      run.id,
      'execution.completed',
      {
        state: 'completed',
        finalArtifactId: null,
        durationMs: 10,
        totalTokens: 10,
        totalCostUsd: 0,
      },
      { key: `${run.id}:completed` }
    );
    await events.emit(
      run.id,
      'execution.completed',
      {
        state: 'completed',
        finalArtifactId: null,
        durationMs: 10,
        totalTokens: 10,
        totalCostUsd: 0,
      },
      { key: `${run.id}:completed` }
    );

    expect(store.types(run.id).filter((type) => type === 'execution.completed')).toHaveLength(1);
  });

  it('propagates cancellation to an in-flight run without completing it', async () => {
    provider = await startMockProvider({ delayMs: 250 });
    const { store, manager } = createHarness(provider);
    const run = store.seed(makeRun({ objective: 'Draft a launch plan for the product.' }));

    await manager.start(run.id);
    await waitFor(
      () => store.types(run.id),
      (types) => types.includes('agent.started'),
      5_000
    );

    const cancelled = await manager.cancel(run.id, 'operator stopped the run');
    expect(cancelled.executionState).toBe('cancelled');
    expect(cancelled.status).toBe('cancelled');

    await waitFor(
      () => store.types(run.id),
      (types) => types.includes('run.cancelled'),
      5_000
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    const types = store.types(run.id);
    expect(types).not.toContain('execution.completed');
    expect((await store.getRun(run.id))?.executionState).toBe('cancelled');
  });

  it('recovers interrupted runs as paused instead of silently rerunning them', async () => {
    const store = new InMemoryOrchestratorStore();
    const manager = createExecutionManager(store, {
      getAdapter: async () => {
        throw new Error('Not used during recovery');
      },
      getConfiguredProviders: async () => [],
    });
    const interrupted = store.seed({
      ...makeRun({ objective: 'Draft a launch plan for the product.' }),
      status: 'running',
      executionState: 'executing',
      stage: 'work',
    });

    await manager.recover();

    const recovered = await store.getRun(interrupted.id);
    expect(recovered?.status).toBe('paused');
    expect(recovered?.executionState).toBe('paused');
    expect(store.types(interrupted.id)).toContain('run.paused');
  });
});

describe('context isolation', () => {
  function artifact(run: Run, userId: string, content: string): Artifact {
    return {
      id: randomUUID(),
      runId: run.id,
      userId,
      name: 'Worker note',
      kind: 'document',
      mimeType: 'text/markdown',
      content,
      version: 1,
      createdByAgentId: null,
      agentName: 'Worker',
      stepId: null,
      createdAt: new Date().toISOString(),
    };
  }

  it('rejects a context request from another user or project', () => {
    const context = new ContextManager(new InMemoryOrchestratorStore());
    const run = makeRun({ objective: 'Draft a launch plan for the product.' });

    expect(() => context.assertIsolation(run, run.userId, run.projectId)).not.toThrow();
    expect(() => context.assertIsolation(run, randomUUID(), run.projectId)).toThrow(
      /another user/i
    );
    expect(() => context.assertIsolation(run, run.userId, randomUUID())).toThrow(
      /another project/i
    );
  });

  it('only includes artifacts owned by the run and bounds the rendered context', async () => {
    const { store } = core();
    const run = store.seed(makeRun({ objective: 'Draft a launch plan for the product.' }));
    const own = artifact(run, run.userId, 'Own output '.repeat(300));
    const foreign = artifact(run, randomUUID(), 'FOREIGN SECRET');
    store.artifacts.set(own.id, own);
    store.artifacts.set(foreign.id, foreign);

    const context = new ContextManager(store);
    const snapshot = await context.build({
      run,
      task: 'Write the market section',
      budgetChars: 600,
      artifactBudgetChars: 300,
      historyBudgetChars: 50,
    });

    expect(snapshot.artifacts.map((item) => item.id)).toEqual([own.id]);
    expect(snapshot.rendered).not.toContain('FOREIGN SECRET');
    expect(snapshot.rendered.length).toBeLessThanOrEqual(600);
    expect(snapshot.truncated).toBe(true);
  });
});
