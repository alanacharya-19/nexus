import type { ApprovalMode, RunStage, RunStatus } from './domain.js';

export const RUN_STAGE_LABELS: Record<RunStage, string> = {
  plan: 'Plan',
  work: 'Execute',
  review: 'Review',
  revise: 'Revise',
  polish: 'Polish',
  deliver: 'Deliver',
};

export const RUN_STAGE_DESCRIPTIONS: Record<RunStage, string> = {
  plan: 'Planner is decomposing the objective into executable steps.',
  work: 'Workers are producing the requested deliverables.',
  review: 'Reviewer is auditing accuracy and completeness.',
  revise: 'Worker is applying the reviewer’s required changes.',
  polish: 'Polisher is preparing the final deliverable.',
  deliver: 'Final deliverable is ready.',
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  awaiting_approval: 'Awaiting approval',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  always: 'Every stage',
  key: 'Plan & review',
  auto: 'Autonomous',
};

export const APPROVAL_MODE_DESCRIPTIONS: Record<ApprovalMode, string> = {
  always: 'You approve the plan, deliverables, review, and final polish.',
  key: 'You approve the plan and the reviewed deliverable. Other stages run through.',
  auto: 'Agents run end to end. You can still pause, steer, or cancel at any time.',
};

export const PIPELINE_STAGES: RunStage[] = ['plan', 'work', 'review', 'polish', 'deliver'];

export function stageRequiresApproval(mode: ApprovalMode, stage: RunStage): boolean {
  if (mode === 'auto') return false;
  if (mode === 'always') return stage !== 'deliver';
  return stage === 'plan' || stage === 'review';
}

export function nextStage(stage: RunStage): RunStage {
  switch (stage) {
    case 'plan':
      return 'work';
    case 'work':
      return 'review';
    case 'review':
      return 'polish';
    case 'revise':
      return 'review';
    case 'polish':
      return 'deliver';
    case 'deliver':
      return 'deliver';
  }
}
