import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { iso, mapInstruction, mapRun } from '../db/mappers.js';
import type {
  AgentExecutionState,
  ApprovalMode,
  ExecutionState,
  Run,
  RunAgent,
  RunEvent,
  RunEventPayloads,
  RunEventType,
  RunInstruction,
  RunPlan,
  RunReview,
  RunStage,
  RunStatus,
  PendingApproval,
} from '@nexus/shared';

export interface RunPatch {
  title?: string;
  projectId?: string | null;
  status?: RunStatus;
  stage?: RunStage;
  executionState?: ExecutionState;
  agents?: RunAgent[];
  plan?: RunPlan | null;
  review?: RunReview | null;
  pendingApproval?: PendingApproval | null;
  currentStep?: number;
  reviewRound?: number;
  revisionCount?: number;
  maxReviewRounds?: number;
  maxDurationMs?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
  currentAgentId?: string | null;
  currentTask?: string | null;
  agentStates?: Record<string, AgentExecutionState>;
  error?: string | null;
  errorCode?: string | null;
  finalArtifactId?: string | null;
  startedAt?: string | null;
  executionStartedAt?: string | null;
  completedAt?: string | null;
}

const RUN_COLUMNS: Record<keyof RunPatch, string> = {
  title: 'title',
  projectId: 'project_id',
  status: 'status',
  stage: 'stage',
  executionState: 'execution_state',
  agents: 'agents',
  plan: 'plan',
  review: 'review',
  pendingApproval: 'pending_approval',
  currentStep: 'current_step',
  reviewRound: 'review_round',
  revisionCount: 'revision_count',
  maxReviewRounds: 'max_review_rounds',
  maxDurationMs: 'max_duration_ms',
  maxTotalTokens: 'max_total_tokens',
  maxCostUsd: 'max_cost_usd',
  currentAgentId: 'current_agent_id',
  currentTask: 'current_task',
  agentStates: 'agent_states',
  error: 'error',
  errorCode: 'error_code',
  finalArtifactId: 'final_artifact_id',
  startedAt: 'started_at',
  executionStartedAt: 'execution_started_at',
  completedAt: 'completed_at',
};

const JSON_COLUMNS = new Set<keyof RunPatch>([
  'agents',
  'plan',
  'review',
  'pendingApproval',
  'agentStates',
]);

export async function createRun(input: {
  userId: string;
  title: string;
  objective: string;
  projectId: string | null;
  templateId: string | null;
  approvalMode: ApprovalMode;
  agents: RunAgent[];
  maxReviewRounds?: number;
  maxDurationMs?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
}): Promise<Run> {
  const result = await query(
    `INSERT INTO runs
      (id, user_id, title, objective, project_id, template_id, approval_mode, agents,
       status, stage, execution_state, max_review_rounds, max_duration_ms,
       max_total_tokens, max_cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued','plan','queued',$9,$10,$11,$12)
     RETURNING *`,
    [
      randomUUID(),
      input.userId,
      input.title,
      input.objective,
      input.projectId,
      input.templateId,
      input.approvalMode,
      JSON.stringify(input.agents),
      input.maxReviewRounds ?? 3,
      input.maxDurationMs ?? 1_800_000,
      input.maxTotalTokens ?? 500_000,
      input.maxCostUsd ?? 3,
    ]
  );
  return mapRun(result.rows[0]!);
}

export async function getRun(userId: string, runId: string): Promise<Run | null> {
  const result = await query(
    `SELECT r.*, p.name AS project_name
     FROM runs r LEFT JOIN projects p ON p.id = r.project_id
     WHERE r.user_id = $1 AND r.id = $2`,
    [userId, runId]
  );
  const row = result.rows[0];
  return row ? mapRun(row) : null;
}

/** Engine-internal lookup. Callers must enforce ownership before exposing data. */
export async function getRunInternal(runId: string): Promise<Run | null> {
  const result = await query('SELECT * FROM runs WHERE id = $1', [runId]);
  const row = result.rows[0];
  return row ? mapRun(row) : null;
}

export async function listRuns(
  userId: string,
  filters: {
    projectId?: string;
    status?: RunStatus;
    search?: string;
    limit: number;
    cursor?: string;
  }
): Promise<{ items: Run[]; nextCursor: string | null }> {
  const conditions = ['r.user_id = $1'];
  const values: unknown[] = [userId];
  let index = 2;

  if (filters.projectId) {
    conditions.push(`r.project_id = $${index}`);
    values.push(filters.projectId);
    index += 1;
  }
  if (filters.status) {
    conditions.push(`r.status = $${index}`);
    values.push(filters.status);
    index += 1;
  }
  if (filters.search) {
    conditions.push(`(r.title ILIKE $${index} OR r.objective ILIKE $${index})`);
    values.push(`%${filters.search}%`);
    index += 1;
  }
  if (filters.cursor) {
    conditions.push(`r.created_at < $${index}`);
    values.push(filters.cursor);
    index += 1;
  }

  values.push(filters.limit + 1);
  const result = await query(
    `SELECT r.*, p.name AS project_name
     FROM runs r LEFT JOIN projects p ON p.id = r.project_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $${index}`,
    values
  );

  const rows = result.rows.slice(0, filters.limit);
  const items = rows.map(mapRun);
  const nextCursor =
    result.rows.length > filters.limit
      ? (iso(rows[rows.length - 1]?.created_at) ?? null)
      : null;
  return { items, nextCursor };
}

export async function patchRun(runId: string, patch: RunPatch): Promise<Run | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  for (const [key, column] of Object.entries(RUN_COLUMNS) as [
    keyof RunPatch,
    string,
  ][]) {
    if (patch[key] === undefined) continue;
    sets.push(`${column} = $${index}`);
    const value = patch[key];
    values.push(JSON_COLUMNS.has(key) ? JSON.stringify(value) : value);
    index += 1;
  }
  if (sets.length === 0) return getRunInternal(runId);

  sets.push('updated_at = now()');
  values.push(runId);
  const result = await query(
    `UPDATE runs SET ${sets.join(', ')} WHERE id = $${index} RETURNING *`,
    values
  );
  const row = result.rows[0];
  return row ? mapRun(row) : null;
}

export async function incrementRunTotals(
  runId: string,
  tokens: number,
  costUsd: number
): Promise<{ totalTokens: number; totalCostUsd: number } | null> {
  const result = await query<{ total_tokens: string; total_cost_usd: string }>(
    `UPDATE runs
     SET total_tokens = total_tokens + $2,
         total_cost_usd = total_cost_usd + $3,
         updated_at = now()
     WHERE id = $1
     RETURNING total_tokens, total_cost_usd`,
    [runId, Math.max(0, Math.round(tokens)), Math.max(0, costUsd)]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    totalTokens: Number(row.total_tokens),
    totalCostUsd: Number(row.total_cost_usd),
  };
}

export async function deleteRun(userId: string, runId: string): Promise<boolean> {
  const result = await query('DELETE FROM runs WHERE user_id = $1 AND id = $2', [
    userId,
    runId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function appendEvent<K extends RunEventType>(
  runId: string,
  type: K,
  payload: RunEventPayloads[K],
  agentId: string | null = null,
  eventKey: string | null = null
): Promise<RunEvent> {
  return withTransaction(async (client) => {
    if (eventKey) {
      const existing = await client.query(
        'SELECT * FROM run_events WHERE run_id = $1 AND event_key = $2',
        [runId, eventKey]
      );
      const row = existing.rows[0];
      if (row) {
        return {
          id: Number(row.id),
          runId: row.run_id,
          seq: Number(row.seq),
          type: row.type,
          agentId: row.agent_id ?? null,
          payload: row.payload,
          createdAt: iso(row.created_at)!,
        } as RunEvent;
      }
    }

    const seqResult = await client.query<{ last_seq: number }>(
      'UPDATE runs SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq',
      [runId]
    );
    const seq = seqResult.rows[0]?.last_seq;
    if (seq === undefined) throw new Error(`Run ${runId} not found while appending event`);

    const result = await client.query(
      `INSERT INTO run_events (run_id, seq, type, agent_id, payload, event_key)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [runId, seq, type, agentId, JSON.stringify(payload), eventKey]
    );
    const row = result.rows[0]!;
    return {
      id: Number(row.id),
      runId: row.run_id,
      seq: Number(row.seq),
      type,
      agentId: row.agent_id ?? null,
      payload,
      createdAt: iso(row.created_at)!,
    } as RunEvent;
  });
}

export async function listEvents(
  runId: string,
  afterSeq = 0,
  limit = 1_000
): Promise<RunEvent[]> {
  const result = await query(
    `SELECT * FROM run_events WHERE run_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
    [runId, afterSeq, limit]
  );
  return result.rows.map(
    (row) =>
      ({
        id: Number(row.id),
        runId: row.run_id,
        seq: Number(row.seq),
        type: row.type,
        agentId: row.agent_id ?? null,
        payload: row.payload,
        createdAt: iso(row.created_at)!,
      }) as RunEvent
  );
}

export async function getLastSeq(runId: string): Promise<number> {
  const result = await query<{ last_seq: number }>(
    'SELECT last_seq FROM runs WHERE id = $1',
    [runId]
  );
  return Number(result.rows[0]?.last_seq ?? 0);
}

export async function createInstruction(
  runId: string,
  content: string,
  stage: RunStage
): Promise<RunInstruction> {
  const result = await query(
    `INSERT INTO run_instructions (id, run_id, content, stage)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [randomUUID(), runId, content, stage]
  );
  return mapInstruction(result.rows[0]!);
}

export async function listInstructions(runId: string): Promise<RunInstruction[]> {
  const result = await query(
    'SELECT * FROM run_instructions WHERE run_id = $1 ORDER BY created_at ASC',
    [runId]
  );
  return result.rows.map(mapInstruction);
}

export async function listUnconsumedInstructions(runId: string): Promise<RunInstruction[]> {
  const result = await query(
    'SELECT * FROM run_instructions WHERE run_id = $1 AND consumed = false ORDER BY created_at ASC',
    [runId]
  );
  return result.rows.map(mapInstruction);
}

export async function consumeInstructions(runId: string): Promise<void> {
  await query(
    'UPDATE run_instructions SET consumed = true WHERE run_id = $1 AND consumed = false',
    [runId]
  );
}

export async function recoverInterruptedRuns(): Promise<Run[]> {
  const result = await query(
    `UPDATE runs
     SET status = 'paused',
         execution_state = 'paused',
         error = 'The server restarted while this run was executing. Resume to continue from the last checkpoint.',
         error_code = 'SERVER_RESTART',
         updated_at = now()
     WHERE status IN ('running', 'queued')
     RETURNING *`
  );
  return result.rows.map(mapRun);
}
