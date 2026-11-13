import type {
  Artifact,
  ArtifactKind,
  ProviderId,
  Run,
  RunEvent,
  RunEventPayloads,
  RunEventType,
  RunInstruction,
  RunStage,
  UsageSource,
  WorkflowTemplate,
} from '@nexus/shared';
import {
  appendEvent,
  consumeInstructions,
  createInstruction,
  getRunInternal,
  incrementRunTotals,
  listEvents,
  listUnconsumedInstructions,
  patchRun,
  recoverInterruptedRuns,
  type RunPatch,
} from '../repositories/runs.js';
import {
  countArtifactVersions,
  createArtifact,
  listArtifactsForRun,
} from '../repositories/artifacts.js';
import { recordUsage } from '../repositories/usage.js';
import { getTemplate } from '../repositories/templates.js';

/**
 * The orchestration engine talks to persistence only through this port. The
 * production implementation uses PostgreSQL; tests use an in-memory store.
 * This keeps the pipeline deterministic and makes it impossible for an agent
 * to reach a run it was not given by the execution manager.
 */
export interface OrchestratorStore {
  getRun(runId: string): Promise<Run | null>;
  patchRun(runId: string, patch: RunPatch): Promise<Run | null>;
  appendEvent<K extends RunEventType>(
    runId: string,
    type: K,
    payload: RunEventPayloads[K],
    agentId?: string | null,
    eventKey?: string | null
  ): Promise<RunEvent>;
  listEvents(runId: string, afterSeq?: number, limit?: number): Promise<RunEvent[]>;
  listArtifacts(runId: string): Promise<Artifact[]>;
  createArtifact(input: CreateArtifactInput): Promise<Artifact>;
  countArtifactVersions(
    runId: string,
    kind: ArtifactKind,
    stepId: string | null
  ): Promise<number>;
  listUnconsumedInstructions(runId: string): Promise<RunInstruction[]>;
  consumeInstructions(runId: string): Promise<void>;
  createInstruction(
    runId: string,
    content: string,
    stage: RunStage
  ): Promise<RunInstruction>;
  getTemplate(userId: string, templateId: string): Promise<WorkflowTemplate | null>;
  recordUsage(input: UsageInput): Promise<void>;
  incrementRunTotals(
    runId: string,
    tokens: number,
    costUsd: number
  ): Promise<{ totalTokens: number; totalCostUsd: number } | null>;
  recoverInterruptedRuns(): Promise<Run[]>;
}

export interface CreateArtifactInput {
  runId: string;
  userId: string;
  name: string;
  kind: ArtifactKind;
  mimeType: string;
  content: string;
  version: number;
  createdByAgentId: string | null;
  agentName: string | null;
  stepId: string | null;
}

export interface UsageInput {
  userId: string;
  runId: string;
  agentId: string;
  agentName: string;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'success' | 'error';
  usageSource?: UsageSource;
  costEstimated?: boolean;
}

export function createPostgresStore(): OrchestratorStore {
  return {
    getRun: getRunInternal,
    patchRun,
    appendEvent,
    listEvents,
    listArtifacts: listArtifactsForRun,
    createArtifact,
    countArtifactVersions,
    listUnconsumedInstructions,
    consumeInstructions,
    createInstruction,
    getTemplate,
    recordUsage: async (input) => {
      await recordUsage(input);
    },
    incrementRunTotals,
    recoverInterruptedRuns,
  };
}

export const postgresStore = createPostgresStore();
