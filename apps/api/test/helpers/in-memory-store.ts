import { randomUUID } from 'node:crypto';
import type {
  Artifact,
  ArtifactKind,
  Run,
  RunEvent,
  RunEventPayloads,
  RunEventType,
  RunInstruction,
  RunStage,
  WorkflowTemplate,
} from '@nexus/shared';
import type { RunPatch } from '../../src/repositories/runs.js';
import type {
  CreateArtifactInput,
  OrchestratorStore,
  UsageInput,
} from '../../src/orchestrator/store.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Deterministic persistence double for orchestration tests. It implements the
 * same port as PostgreSQL so the pipeline, state machine, and event ordering
 * are exercised without a live database.
 */
export class InMemoryOrchestratorStore implements OrchestratorStore {
  runs = new Map<string, Run>();
  events = new Map<string, RunEvent[]>();
  artifacts = new Map<string, Artifact>();
  instructions = new Map<string, RunInstruction>();
  usage: UsageInput[] = [];
  private sequence = 0;
  private eventIds = 0;

  seed(run: Run): Run {
    this.runs.set(run.id, clone(run));
    return clone(run);
  }

  async getRun(runId: string): Promise<Run | null> {
    const run = this.runs.get(runId);
    return run ? clone(run) : null;
  }

  async patchRun(runId: string, patch: RunPatch): Promise<Run | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    const next: Run = {
      ...run,
      ...(patch as Partial<Run>),
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, next);
    return clone(next);
  }

  async appendEvent<K extends RunEventType>(
    runId: string,
    type: K,
    payload: RunEventPayloads[K],
    agentId: string | null = null,
    eventKey: string | null = null
  ): Promise<RunEvent> {
    const existing = this.events.get(runId) ?? [];
    if (eventKey) {
      const deduped = existing.find(
        (event) => (event as { eventKey?: string | null }).eventKey === eventKey
      );
      if (deduped) return clone(deduped);
    }
    this.sequence += 1;
    this.eventIds += 1;
    const event = {
      id: this.eventIds,
      runId,
      seq: this.sequence,
      type,
      agentId,
      payload,
      createdAt: new Date().toISOString(),
    } as RunEvent & { eventKey?: string | null };
    if (eventKey) event.eventKey = eventKey;
    existing.push(event);
    this.events.set(runId, existing);
    return clone(event);
  }

  async listEvents(runId: string, afterSeq = 0, limit = 1_000): Promise<RunEvent[]> {
    return clone(
      (this.events.get(runId) ?? [])
        .filter((event) => event.seq > afterSeq)
        .slice(0, limit)
    );
  }

  async listArtifacts(runId: string): Promise<Artifact[]> {
    return clone(
      Array.from(this.artifacts.values())
        .filter((artifact) => artifact.runId === runId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  }

  async createArtifact(input: CreateArtifactInput): Promise<Artifact> {
    const artifact: Artifact = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.artifacts.set(artifact.id, artifact);
    return clone(artifact);
  }

  async countArtifactVersions(
    runId: string,
    kind: ArtifactKind,
    stepId: string | null
  ): Promise<number> {
    return Array.from(this.artifacts.values()).filter(
      (artifact) =>
        artifact.runId === runId &&
        artifact.kind === kind &&
        (artifact.stepId ?? null) === stepId
    ).length;
  }

  async listUnconsumedInstructions(runId: string): Promise<RunInstruction[]> {
    return clone(
      Array.from(this.instructions.values()).filter(
        (instruction) => instruction.runId === runId && !instruction.consumed
      )
    );
  }

  async consumeInstructions(runId: string): Promise<void> {
    for (const instruction of this.instructions.values()) {
      if (instruction.runId === runId) instruction.consumed = true;
    }
  }

  async createInstruction(
    runId: string,
    content: string,
    stage: RunStage
  ): Promise<RunInstruction> {
    const instruction: RunInstruction = {
      id: randomUUID(),
      runId,
      content,
      stage,
      consumed: false,
      createdAt: new Date().toISOString(),
    };
    this.instructions.set(instruction.id, instruction);
    return clone(instruction);
  }

  async getTemplate(_userId: string, _templateId: string): Promise<WorkflowTemplate | null> {
    return null;
  }

  async recordUsage(input: UsageInput): Promise<void> {
    this.usage.push(clone(input));
  }

  async incrementRunTotals(
    runId: string,
    tokens: number,
    costUsd: number
  ): Promise<{ totalTokens: number; totalCostUsd: number } | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    run.totalTokens += tokens;
    run.totalCostUsd += costUsd;
    return { totalTokens: run.totalTokens, totalCostUsd: run.totalCostUsd };
  }

  async recoverInterruptedRuns(): Promise<Run[]> {
    const recovered: Run[] = [];
    for (const run of this.runs.values()) {
      if (run.status === 'running' || run.status === 'queued') {
        run.status = 'paused';
        run.executionState = 'paused';
        recovered.push(clone(run));
      }
    }
    return recovered;
  }

  types(runId: string): RunEventType[] {
    return (this.events.get(runId) ?? []).map((event) => event.type);
  }
}
