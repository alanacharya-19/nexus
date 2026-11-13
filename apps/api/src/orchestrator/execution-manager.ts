import type { Run, RunInstruction, RunStage } from '@nexus/shared';
import { config } from '../config.js';
import { Errors } from '../errors.js';
import type { ApprovalManager } from './approval-manager.js';
import { CancellationManager, type RunControl } from './cancellation-manager.js';
import { ExecutionEventEmitter } from './event-emitter.js';
import type { Orchestrator } from './orchestrator.js';
import {
  isTerminalState,
  stateForStage,
  StateManager,
  statusForState,
} from './state-manager.js';
import type { OrchestratorStore } from './store.js';

export interface ExecutionManagerDeps {
  store: OrchestratorStore;
  events: ExecutionEventEmitter;
  states: StateManager;
  approvals: ApprovalManager;
  orchestrator: Orchestrator;
  cancellation: CancellationManager;
  maxConcurrentRuns?: number;
}

/**
 * Owns the run queue and the control surface used by the API: start, resume,
 * pause, cancel, retry, approve, steer, and restart recovery. The orchestrator
 * below it only sees one run at a time.
 */
export class ExecutionManager {
  private queue: string[] = [];
  private pumping = false;

  constructor(private readonly deps: ExecutionManagerDeps) {}

  async start(runId: string): Promise<Run> {
    const run = await this.deps.store.getRun(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status !== 'queued' || run.executionState !== 'queued') {
      throw Errors.invalidState(`Run cannot be started from state "${run.executionState}".`);
    }

    const now = new Date().toISOString();
    const updated = await this.deps.states.transition(run, 'planning', {
      error: null,
      errorCode: null,
      pendingApproval: null,
      currentTask: null,
      startedAt: run.startedAt ?? now,
      executionStartedAt: run.executionStartedAt ?? now,
    });

    await this.deps.events.emit(runId, 'run.started', { resumed: false });
    await this.deps.events.emit(runId, 'execution.started', {
      state: 'planning',
      objective: run.objective,
      pipeline: ['planner', 'worker', 'reviewer', 'polisher'],
    });
    this.enqueue(runId);
    return updated;
  }

  async resume(runId: string): Promise<Run> {
    const run = await this.deps.store.getRun(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status === 'awaiting_approval' || run.executionState === 'awaiting_approval') {
      throw Errors.invalidState('Approve or reject the pending decision before resuming.');
    }
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw Errors.invalidState(`Run is ${run.status} and cannot be resumed.`);
    }
    if (run.status === 'failed' || run.executionState === 'failed') {
      throw Errors.invalidState('Use retry to restart a failed run.');
    }
    if (run.status === 'running' && this.deps.cancellation.has(runId)) return run;

    const target = this.resumeState(run);
    const updated = await this.deps.states.transition(run, target, {
      error: null,
      errorCode: null,
      pendingApproval: null,
    });
    await this.deps.events.emit(runId, 'run.resumed', { fromStage: run.stage });
    this.enqueue(runId);
    return updated;
  }

  async pause(runId: string): Promise<Run> {
    const run = await this.deps.store.getRun(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status === 'paused' || run.executionState === 'paused') return run;
    if (run.status !== 'running' && run.status !== 'queued') {
      throw Errors.invalidState(`Run cannot be paused from status "${run.status}".`);
    }

    this.removeFromQueue(runId);
    this.deps.cancellation.pause(runId);
    const updated = await this.deps.states.transition(run, 'paused', {
      pendingApproval: null,
    });
    this.deps.events.clearLive(runId);
    return updated;
  }

  async cancel(runId: string, reason: string | null = null): Promise<Run> {
    const run = await this.deps.store.getRun(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status === 'completed' || run.executionState === 'completed') {
      throw Errors.invalidState('Completed runs cannot be cancelled.');
    }
    if (run.status === 'cancelled' || run.executionState === 'cancelled') return run;

    this.removeFromQueue(runId);
    this.deps.cancellation.cancel(runId);
    const updated = await this.deps.states.transition(run, 'cancelled', {
      pendingApproval: null,
      completedAt: new Date().toISOString(),
      currentTask: null,
    });
    await this.deps.events.emit(runId, 'run.cancelled', { reason });
    this.deps.events.clearLive(runId);
    return updated;
  }

  async retry(runId: string, restartStage = false): Promise<Run> {
    const run = await this.deps.store.getRun(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status === 'awaiting_approval' || run.executionState === 'awaiting_approval') {
      throw Errors.invalidState('Resolve the pending approval before retrying.');
    }
    if (run.status === 'completed' || run.executionState === 'completed') {
      throw Errors.invalidState('Completed runs cannot be retried.');
    }

    let plan = run.plan;
    let currentStep = run.currentStep;
    let review = run.review;
    let reviewRound = run.reviewRound;
    let revisionCount = run.revisionCount;

    if (restartStage && run.stage === 'plan') {
      plan = null;
      currentStep = 0;
      review = null;
      reviewRound = 0;
      revisionCount = 0;
    } else if (plan) {
      plan = {
        ...plan,
        steps: plan.steps.map((step) => {
          if (step.status === 'done' && !(restartStage && run.stage === 'work')) {
            return step;
          }
          return {
            ...step,
            status: 'pending' as const,
            outputArtifactId: null,
            attempts: restartStage && run.stage === 'work' ? 0 : step.attempts ?? 0,
          };
        }),
      };
      if (restartStage && run.stage === 'work') currentStep = 0;
    }

    const agentStates = Object.fromEntries(
      Object.entries(run.agentStates).map(([id, state]) => [
        id,
        state.status === 'failed' || state.status === 'activated'
          ? { ...state, status: 'idle' as const, error: null, currentTask: null }
          : state,
      ])
    );

    const target = this.retryState(run, restartStage);
    const updated = await this.deps.states.transition(run, target, {
      plan,
      currentStep,
      review,
      reviewRound,
      revisionCount,
      agentStates,
      error: null,
      errorCode: null,
      pendingApproval: null,
      completedAt: null,
      executionStartedAt: run.executionStartedAt ?? new Date().toISOString(),
    });
    await this.deps.events.emit(runId, 'run.retried', { stage: run.stage });
    await this.deps.events.emit(runId, 'run.started', { resumed: true });
    this.enqueue(runId);
    return updated;
  }

  async steer(runId: string, content: string): Promise<RunInstruction> {
    const run = await this.deps.store.getRun(runId);
    if (!run) throw Errors.notFound('Run');
    if (isTerminalState(run.executionState)) {
      throw Errors.invalidState('This run has finished and cannot be steered.');
    }

    const instruction = await this.deps.store.createInstruction(runId, content, run.stage);
    await this.deps.events.emit(runId, 'user.instruction', { content });
    this.deps.cancellation.steer(runId);
    return instruction;
  }

  async approve(
    runId: string,
    decision: 'approve' | 'reject',
    note: string | null
  ): Promise<Run> {
    const run = await this.deps.store.getRun(runId);
    if (!run) throw Errors.notFound('Run');
    const resolution = await this.deps.approvals.resolve(run, decision, note);

    if (resolution.state === 'completed') {
      await this.deps.orchestrator.announceCompletion(resolution.run);
    } else {
      this.enqueue(runId);
    }
    return resolution.run;
  }

  getLive(runId: string) {
    return this.deps.events.getLive(runId);
  }

  isActive(runId: string): boolean {
    return this.deps.cancellation.has(runId) || this.queue.includes(runId);
  }

  get activeCount(): number {
    return this.deps.cancellation.activeCount;
  }

  async recover(): Promise<void> {
    const interrupted = await this.deps.store.recoverInterruptedRuns();
    for (const run of interrupted) {
      await this.deps.events.emit(run.id, 'run.paused', { reason: 'interrupt' });
      await this.deps.events.emit(run.id, 'run.status', {
        status: statusForState('paused'),
      });
      this.deps.events.clearLive(run.id);
    }
    if (interrupted.length > 0) {
      console.info(`Recovered ${interrupted.length} interrupted run(s) as paused.`);
    }
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  private enqueue(runId: string): void {
    if (!this.queue.includes(runId) && !this.deps.cancellation.has(runId)) {
      this.queue.push(runId);
    }
    this.pump();
  }

  private removeFromQueue(runId: string): void {
    this.queue = this.queue.filter((id) => id !== runId);
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    queueMicrotask(() => {
      this.pumping = false;
      const limit = this.deps.maxConcurrentRuns ?? config.maxConcurrentRuns;
      while (this.deps.cancellation.activeCount < limit && this.queue.length > 0) {
        const runId = this.queue.shift()!;
        if (this.deps.cancellation.has(runId)) continue;
        const control: RunControl = this.deps.cancellation.create(runId);
        void this.execute(runId, control);
      }
    });
  }

  private async execute(runId: string, control: RunControl): Promise<void> {
    try {
      await this.deps.orchestrator.execute(runId);
    } catch (error) {
      console.error('Orchestration loop crashed', { runId, error });
    } finally {
      if (control.mode === 'steer') {
        this.deps.cancellation.reset(runId);
      }
      this.deps.events.clearLive(runId);
      this.deps.cancellation.release(runId);
      this.pump();
    }
  }

  private resumeState(run: Run) {
    if (run.stage === 'deliver') return 'completed' as const;
    return stateForStage(run.stage);
  }

  private retryState(run: Run, restartStage: boolean) {
    if (restartStage && run.stage === 'plan') return 'planning' as const;
    switch (run.stage) {
      case 'plan':
        return 'planning' as const;
      case 'work':
        return 'executing' as const;
      case 'review':
        return 'reviewing' as const;
      case 'revise':
        return 'revising' as const;
      case 'polish':
        return 'polishing' as const;
      case 'deliver':
        return 'executing' as const;
    }
  }
}

export type { RunStage };
