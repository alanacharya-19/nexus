import type {
  ExecutionState,
  Run,
  RunStage,
  RunStatus,
} from '@nexus/shared';
import { Errors } from '../errors.js';
import type { RunPatch } from '../repositories/runs.js';
import type { ExecutionEventEmitter } from './event-emitter.js';
import type { OrchestratorStore } from './store.js';

/**
 * Allowed state transitions. Anything not listed here is rejected before a
 * write happens, which prevents impossible pipelines (for example polishing a
 * run that never executed) and makes recovery conversations explicit.
 */
export const EXECUTION_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  queued: ['planning', 'paused', 'failed', 'cancelled'],
  planning: [
    'executing',
    'awaiting_approval',
    'paused',
    'failed',
    'cancelled',
  ],
  executing: [
    'reviewing',
    'awaiting_approval',
    'paused',
    'failed',
    'cancelled',
  ],
  reviewing: [
    'revising',
    'polishing',
    'awaiting_approval',
    'paused',
    'failed',
    'cancelled',
  ],
  revising: [
    'reviewing',
    'awaiting_approval',
    'paused',
    'failed',
    'cancelled',
  ],
  polishing: [
    'completed',
    'awaiting_approval',
    'paused',
    'failed',
    'cancelled',
  ],
  awaiting_approval: [
    'planning',
    'executing',
    'reviewing',
    'revising',
    'polishing',
    'paused',
    'failed',
    'cancelled',
  ],
  paused: [
    'planning',
    'executing',
    'reviewing',
    'revising',
    'polishing',
    'awaiting_approval',
    'completed',
    'failed',
    'cancelled',
  ],
  completed: [],
  failed: [
    'planning',
    'executing',
    'reviewing',
    'revising',
    'polishing',
    'cancelled',
  ],
  cancelled: [
    'planning',
    'executing',
    'reviewing',
    'revising',
    'polishing',
  ],
};

const RUNNING_STATES: ExecutionState[] = [
  'planning',
  'executing',
  'reviewing',
  'revising',
  'polishing',
];

export function isRunningState(state: ExecutionState): boolean {
  return RUNNING_STATES.includes(state);
}

export function isTerminalState(state: ExecutionState): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function statusForState(state: ExecutionState): RunStatus {
  switch (state) {
    case 'queued':
      return 'queued';
    case 'planning':
    case 'executing':
    case 'reviewing':
    case 'revising':
    case 'polishing':
      return 'running';
    case 'awaiting_approval':
      return 'awaiting_approval';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

export function stageForState(state: ExecutionState): RunStage | null {
  switch (state) {
    case 'queued':
    case 'planning':
      return 'plan';
    case 'executing':
      return 'work';
    case 'reviewing':
      return 'review';
    case 'revising':
      return 'revise';
    case 'polishing':
      return 'polish';
    case 'completed':
      return 'deliver';
    default:
      return null;
  }
}

export function stateForStage(stage: RunStage): ExecutionState {
  switch (stage) {
    case 'plan':
      return 'planning';
    case 'work':
      return 'executing';
    case 'review':
      return 'reviewing';
    case 'revise':
      return 'revising';
    case 'polish':
      return 'polishing';
    case 'deliver':
      return 'completed';
  }
}

export class StateManager {
  constructor(
    private readonly store: OrchestratorStore,
    private readonly events: ExecutionEventEmitter
  ) {}

  assertTransition(from: ExecutionState, to: ExecutionState): void {
    if (from === to) return;
    const allowed = EXECUTION_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw Errors.invalidState(
        `Execution cannot move from "${from}" to "${to}".`
      );
    }
  }

  async transition(
    run: Run,
    next: ExecutionState,
    patch: RunPatch = {},
    options: { emit?: boolean } = {}
  ): Promise<Run> {
    const previous = run.executionState ?? 'queued';
    this.assertTransition(previous, next);

    const status = statusForState(next);
    const stage = stageForState(next) ?? patch.stage ?? run.stage;
    const merged: RunPatch = {
      ...patch,
      executionState: next,
      status,
      stage,
    };

    if (next === 'completed') {
      merged.completedAt = patch.completedAt ?? new Date().toISOString();
    }
    if (next === 'paused' || next === 'cancelled' || next === 'failed') {
      merged.pendingApproval = patch.pendingApproval ?? null;
    }
    if (next === 'planning' && !run.startedAt) {
      merged.startedAt = new Date().toISOString();
    }

    const updated = await this.store.patchRun(run.id, merged);
    if (!updated) throw Errors.notFound('Run');

    if (options.emit !== false && previous !== next) {
      await this.events.emit(run.id, 'execution.state', {
        state: next,
        previous,
        stage,
        status,
      });
      await this.events.emit(run.id, 'run.status', { status });
      if (next === 'paused') {
        await this.events.emit(run.id, 'run.paused', { reason: 'user' });
      }
    }

    return updated;
  }
}
