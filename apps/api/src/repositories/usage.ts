import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { mapUsage } from '../db/mappers.js';
import {
  getModel,
  PROVIDER_META,
  type ProviderId,
  type UsageBucket,
  type UsageRecord,
  type UsageSummary,
} from '@nexus/shared';

export async function recordUsage(input: {
  userId: string;
  runId: string | null;
  agentId: string | null;
  agentName: string | null;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'success' | 'error';
}): Promise<UsageRecord> {
  const result = await query(
    `INSERT INTO usage_records
      (id, user_id, run_id, agent_id, agent_name, provider, model, input_tokens, output_tokens, cost_usd, latency_ms, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      randomUUID(),
      input.userId,
      input.runId,
      input.agentId,
      input.agentName,
      input.provider,
      input.model,
      Math.max(0, Math.round(input.inputTokens)),
      Math.max(0, Math.round(input.outputTokens)),
      Math.max(0, input.costUsd),
      Math.max(0, Math.round(input.latencyMs)),
      input.status,
    ]
  );
  return mapUsage(result.rows[0]!);
}

function toBuckets(rows: Record<string, any>[], label: (row: any) => string): UsageBucket[] {
  return rows.map((row) => {
    const inputTokens = Number(row.input_tokens ?? 0);
    const outputTokens = Number(row.output_tokens ?? 0);
    return {
      key: String(row.key),
      label: label(row),
      inputTokens,
      outputTokens,
      tokens: inputTokens + outputTokens,
      costUsd: Number(row.cost_usd ?? 0),
      calls: Number(row.calls ?? 0),
    };
  });
}

export async function getUsageSummary(
  userId: string,
  days: number
): Promise<UsageSummary> {
  const params = [userId, days];

  const [totals, byProvider, byModel, byAgent, byDay] = await Promise.all([
    query(
      `SELECT
         COALESCE(sum(input_tokens) FILTER (WHERE status = 'success'), 0)::bigint AS input_tokens,
         COALESCE(sum(output_tokens) FILTER (WHERE status = 'success'), 0)::bigint AS output_tokens,
         COALESCE(sum(cost_usd) FILTER (WHERE status = 'success'), 0)::numeric AS cost_usd,
         count(*)::int AS calls
       FROM usage_records
       WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2)`,
      params
    ),
    query(
      `SELECT provider AS key,
              COALESCE(sum(input_tokens) FILTER (WHERE status = 'success'), 0)::bigint AS input_tokens,
              COALESCE(sum(output_tokens) FILTER (WHERE status = 'success'), 0)::bigint AS output_tokens,
              COALESCE(sum(cost_usd) FILTER (WHERE status = 'success'), 0)::numeric AS cost_usd,
              count(*)::int AS calls
       FROM usage_records
       WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2)
       GROUP BY provider ORDER BY cost_usd DESC`,
      params
    ),
    query(
      `SELECT model AS key,
              COALESCE(sum(input_tokens) FILTER (WHERE status = 'success'), 0)::bigint AS input_tokens,
              COALESCE(sum(output_tokens) FILTER (WHERE status = 'success'), 0)::bigint AS output_tokens,
              COALESCE(sum(cost_usd) FILTER (WHERE status = 'success'), 0)::numeric AS cost_usd,
              count(*)::int AS calls
       FROM usage_records
       WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2)
       GROUP BY model ORDER BY cost_usd DESC`,
      params
    ),
    query(
      `SELECT COALESCE(agent_name, 'Unassigned') AS key,
              COALESCE(sum(input_tokens) FILTER (WHERE status = 'success'), 0)::bigint AS input_tokens,
              COALESCE(sum(output_tokens) FILTER (WHERE status = 'success'), 0)::bigint AS output_tokens,
              COALESCE(sum(cost_usd) FILTER (WHERE status = 'success'), 0)::numeric AS cost_usd,
              count(*)::int AS calls
       FROM usage_records
       WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2)
       GROUP BY COALESCE(agent_name, 'Unassigned') ORDER BY cost_usd DESC`,
      params
    ),
    query(
      `WITH day_series AS (
         SELECT generate_series(
           date_trunc('day', now()) - make_interval(days => $2 - 1),
           date_trunc('day', now()),
           interval '1 day'
         ) AS day
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS key,
              COALESCE(sum(u.input_tokens) FILTER (WHERE u.status = 'success'), 0)::bigint AS input_tokens,
              COALESCE(sum(u.output_tokens) FILTER (WHERE u.status = 'success'), 0)::bigint AS output_tokens,
              COALESCE(sum(u.cost_usd) FILTER (WHERE u.status = 'success'), 0)::numeric AS cost_usd,
              count(u.id)::int AS calls
       FROM day_series d
       LEFT JOIN usage_records u
         ON u.user_id = $1
        AND u.created_at >= d.day
        AND u.created_at < d.day + interval '1 day'
       GROUP BY d.day ORDER BY d.day ASC`,
      params
    ),
  ]);

  const totalRow = totals.rows[0] ?? {};
  const totalInputTokens = Number(totalRow.input_tokens ?? 0);
  const totalOutputTokens = Number(totalRow.output_tokens ?? 0);
  const from = new Date(Date.now() - (days - 1) * 86_400_000);
  from.setUTCHours(0, 0, 0, 0);

  return {
    from: from.toISOString(),
    to: new Date().toISOString(),
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    totalCostUsd: Number(totalRow.cost_usd ?? 0),
    calls: Number(totalRow.calls ?? 0),
    byProvider: toBuckets(byProvider.rows, (row) =>
      PROVIDER_META[row.key as ProviderId]?.label ?? String(row.key)
    ),
    byModel: toBuckets(byModel.rows, (row) => getModel(String(row.key))?.label ?? String(row.key)),
    byAgent: toBuckets(byAgent.rows, (row) => String(row.key)),
    byDay: toBuckets(byDay.rows, (row) => String(row.key)),
  };
}

export async function listUsageRecords(
  userId: string,
  limit = 100
): Promise<UsageRecord[]> {
  const result = await query(
    `SELECT * FROM usage_records WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map(mapUsage);
}
