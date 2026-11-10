import type {
  ArtifactKind,
  LiveAgentOutput,
  PlanStep,
  ProviderId,
  Run,
  RunPlan,
  RunReview,
  RunStage,
  RunStatus,
} from './domain.js';

/**
 * Every state transition in a run is recorded as an ordered event. Events are
 * persisted before they are fanned out to SSE subscribers, which makes the
 * activity timeline replayable and reconnect-safe.
 */
export interface RunEventPayloads {
  'run.created': { title: string; stage: RunStage };
  'run.started': { resumed: boolean };
  'run.stage': { stage: RunStage; previous: RunStage };
  'run.status': { status: RunStatus };
  'plan.created': { plan: RunPlan };
  'plan.updated': { plan: RunPlan };
  'step.updated': { step: PlanStep; index: number };
  'agent.started': {
    agentId: string;
    agentName: string;
    role: string;
    model: string;
    provider: ProviderId;
    stage: RunStage;
  };
  'agent.token': { agentId: string; delta: string };
  'agent.message': { agentId: string; text: string; stage: RunStage };
  'agent.completed': { agentId: string; summary: string | null; artifactId: string | null };
  'agent.failed': { agentId: string; message: string; code: string };
  'agent.steered': { agentId: string; instruction: string };
  'agent.handoff': { fromAgentId: string; toAgentId: string; reason: string };
  'approval.requested': { stage: RunStage; title: string; summary: string };
  'approval.resolved': {
    stage: RunStage;
    decision: 'approved' | 'rejected';
    note: string | null;
  };
  'review.completed': { review: RunReview };
  'artifact.created': {
    artifactId: string;
    name: string;
    kind: ArtifactKind;
    version: number;
  };
  'usage.recorded': {
    provider: ProviderId;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  'user.instruction': { content: string };
  'run.paused': { reason: 'user' | 'interrupt' };
  'run.resumed': { fromStage: RunStage };
  'run.cancelled': { reason: string | null };
  'run.retried': { stage: RunStage };
  'run.completed': { finalArtifactId: string | null };
  'run.failed': { message: string; code: string };
}

export type RunEventType = keyof RunEventPayloads;

export type RunEvent = {
  [K in RunEventType]: {
    id: number;
    runId: string;
    seq: number;
    type: K;
    agentId: string | null;
    payload: RunEventPayloads[K];
    createdAt: string;
  };
}[RunEventType];

export type RunEventOf<K extends RunEventType> = Extract<RunEvent, { type: K }>;

export interface StreamReady {
  runId: string;
  lastSeq: number;
  live: LiveAgentOutput | null;
}

export interface StreamSnapshot {
  run: Run;
}

export interface StreamError {
  code: string;
  message: string;
}

/** Wire format for the SSE endpoint. */
export type StreamMessage =
  | { event: 'stream.ready'; data: StreamReady }
  | { event: 'run.event'; data: RunEvent }
  | { event: 'run.snapshot'; data: StreamSnapshot }
  | { event: 'stream.heartbeat'; data: { at: string } }
  | { event: 'stream.error'; data: StreamError };
