import type { ExecutionState, Run, RunStage } from '@nexus/shared';
import { stageRequiresApproval } from '@nexus/shared';
import { Errors } from '../errors.js';
import type { RunPatch } from '../repositories/runs.js';
import type { ExecutionEventEmitter } from './event-emitter.js';
import { StateManager } from './state-manager.js';
import type { OrchestratorStore } from './store.js';

export interface ApprovalResolution {
  run: Run;
  state: ExecutionState;
  stage: RunStage;
  decision: 'approved' | 'rejected';
}

/**
 * Persists human-in-the-loop gates and turns an approval decision into exactly
 * one validated state transition. Rejections never restart completed steps.
 */
export class ApprovalManager {
  constructor(
    private readonly store: OrchestratorStore,
    private readonly events: ExecutionEventEmitter,
    private readonly states: StateManager
  ) {}

  shouldRequest(run: Run, stage: RunStage): boolean {
    if (stage === 'deliver') return false;
    return stageRequiresApproval(run.approvalMode, stage);
  }

  async request(run: Run, stage: RunStage, title: string, summary: string): Promise<Run> {
    const pendingApproval = {
      stage,
      title,
      summary,
      requestedAt: new Date().toISOString(),
    };
    const updated = await this.states.transition(run, 'awaiting_approval', {
      pendingApproval,
    });
    await this.events.emit(
      run.id,
      'approval.requested',
      { stage, title, summary },
      { agentId: null }
    );
    return updated;
  }

  async resolve(
    run: Run,
    decision: 'approve' | 'reject',
    note: string | null
  ): Promise<ApprovalResolution> {
    if (run.executionState !== 'awaiting_approval' || !run.pendingApproval) {
      throw Errors.invalidState('There is no pending approval for this run.');
    }

    const stage = run.pendingApproval.stage;
    const normalizedNote = note?.trim() ? note.trim() : null;
    await this.events.emit(run.id, 'approval.resolved', {
      stage,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      note: normalizedNote,
    });

    if (normalizedNote) {
      await this.store.createInstruction(run.id, normalizedNote, stage);
      await this.events.emit(run.id, 'user.instruction', { content: normalizedNote });
    }

    const patch: RunPatch = {
      pendingApproval: null,
      error: null,
      errorCode: null,
    };

    let nextState: ExecutionState;
    if (decision === 'approve') {
      nextState = this.stateAfterApproval(stage, Boolean(run.review));
      if (stage === 'plan') patch.currentStep = 0;
      if (stage === 'review') {
        await this.events.emit(run.id, 'approval.granted', {
          stage,
          title: 'Review approved',
          note: normalizedNote,
        });
      }
    } else {
      nextState = this.stateAfterRejection(stage, run);
      Object.assign(patch, this.rejectionPatch(stage, run));
    }

    const updated = await this.states.transition(run, nextState, patch);
    await this.events.emit(run.id, 'run.stage', {
      stage: updated.stage,
      previous: stage,
    });

    return {
      run: updated,
      state: nextState,
      stage: updated.stage,
      decision: decision === 'approve' ? 'approved' : 'rejected',
    };
  }

  private stateAfterApproval(stage: RunStage, hasReview: boolean): ExecutionState {
    switch (stage) {
      case 'plan':
        return 'executing';
      case 'work':
        return 'reviewing';
      case 'review':
        return 'polishing';
      case 'revise':
        return hasReview ? 'reviewing' : 'executing';
      case 'polish':
        return 'completed';
      case 'deliver':
        return 'completed';
    }
  }

  private stateAfterRejection(stage: RunStage, run: Run): ExecutionState {
    switch (stage) {
      case 'plan':
        return 'planning';
      case 'work':
        return 'executing';
      case 'review':
        return run.review ? 'revising' : 'executing';
      case 'revise':
        return 'revising';
      case 'polish':
        return run.review ? 'reviewing' : 'polishing';
      case 'deliver':
        return 'executing';
    }
  }

  private rejectionPatch(stage: RunStage, run: Run): RunPatch {
    switch (stage) {
      case 'plan':
        return { plan: null, currentStep: 0, review: null, reviewRound: 0 };
      case 'work':
        return {
          currentStep: 0,
          plan: run.plan
            ? {
                ...run.plan,
                steps: run.plan.steps.map((step) => ({
                  ...step,
                  status: 'pending' as const,
                  outputArtifactId: null,
                  attempts: 0,
                })),
              }
            : null,
        };
      case 'review':
        return { currentStep: 0 };
      case 'polish':
        return run.review ? { currentStep: 0 } : {};
      default:
        return {};
    }
  }
}
