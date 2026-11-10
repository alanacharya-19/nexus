import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { mapAgent } from '../db/mappers.js';
import type { Agent, AgentRole, ProviderId } from '@nexus/shared';
import { BASE_SYSTEM_PROMPTS, DEFAULT_AGENTS, defaultLineup } from '@nexus/shared';
import { config } from '../config.js';

export async function listAgents(userId: string): Promise<Agent[]> {
  const result = await query(
    'SELECT * FROM agents WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
  return result.rows.map(mapAgent);
}

export async function getAgent(userId: string, agentId: string): Promise<Agent | null> {
  const result = await query('SELECT * FROM agents WHERE user_id = $1 AND id = $2', [
    userId,
    agentId,
  ]);
  const row = result.rows[0];
  return row ? mapAgent(row) : null;
}

export async function createAgent(
  userId: string,
  input: {
    name: string;
    role: AgentRole;
    provider: ProviderId;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    accent: string;
    enabled: boolean;
    isDefault?: boolean;
  }
): Promise<Agent> {
  const result = await query(
    `INSERT INTO agents
      (id, user_id, name, role, provider, model, system_prompt, temperature, max_tokens, accent, enabled, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      randomUUID(),
      userId,
      input.name,
      input.role,
      input.provider,
      input.model,
      input.systemPrompt,
      input.temperature,
      input.maxTokens,
      input.accent,
      input.enabled,
      input.isDefault ?? false,
    ]
  );
  return mapAgent(result.rows[0]!);
}

const AGENT_COLUMNS: Record<string, string> = {
  name: 'name',
  role: 'role',
  provider: 'provider',
  model: 'model',
  systemPrompt: 'system_prompt',
  temperature: 'temperature',
  maxTokens: 'max_tokens',
  accent: 'accent',
  enabled: 'enabled',
};

export async function updateAgent(
  userId: string,
  agentId: string,
  patch: Partial<{
    name: string;
    role: AgentRole;
    provider: ProviderId;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    accent: string;
    enabled: boolean;
  }>
): Promise<Agent | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  for (const [key, column] of Object.entries(AGENT_COLUMNS)) {
    if (patch[key as keyof typeof patch] !== undefined) {
      sets.push(`${column} = $${index}`);
      values.push(patch[key as keyof typeof patch]);
      index += 1;
    }
  }
  if (sets.length === 0) return getAgent(userId, agentId);

  sets.push('updated_at = now()');
  values.push(userId, agentId);
  const result = await query(
    `UPDATE agents SET ${sets.join(', ')} WHERE user_id = $${index} AND id = $${index + 1} RETURNING *`,
    values
  );
  const row = result.rows[0];
  return row ? mapAgent(row) : null;
}

export async function deleteAgent(userId: string, agentId: string): Promise<boolean> {
  const result = await query('DELETE FROM agents WHERE user_id = $1 AND id = $2', [
    userId,
    agentId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

function availableServerProviders(): ProviderId[] {
  return (Object.keys(config.providerKeys) as ProviderId[]).filter(
    (provider) => config.providerKeys[provider]
  );
}

/**
 * Give every new user a complete, working default team. If the operator has
 * server-side keys we use only those providers; otherwise we seed the
 * cross-provider lineup and the UI guides the user to connect a key.
 */
export async function seedDefaultAgents(userId: string): Promise<Agent[]> {
  const existing = await query<{ count: string }>(
    'SELECT count(*)::text AS count FROM agents WHERE user_id = $1',
    [userId]
  );
  if (Number(existing.rows[0]?.count ?? '0') > 0) {
    return listAgents(userId);
  }

  const available = availableServerProviders();
  const lineup = defaultLineup(available.length > 0 ? available : ['openai', 'anthropic', 'google']);

  return withTransaction(async (client) => {
    const created: Agent[] = [];
    for (const defaults of DEFAULT_AGENTS) {
      const choice = lineup[defaults.role];
      const result = await client.query(
        `INSERT INTO agents
          (id, user_id, name, role, provider, model, system_prompt, temperature, max_tokens, accent, enabled, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true)
         RETURNING *`,
        [
          randomUUID(),
          userId,
          defaults.name,
          defaults.role,
          choice.provider,
          choice.model,
          BASE_SYSTEM_PROMPTS[defaults.role],
          defaults.role === 'reviewer' ? 0.2 : 0.4,
          defaults.role === 'planner' ? 4096 : 8192,
          defaults.accent,
        ]
      );
      created.push(mapAgent(result.rows[0]!));
    }
    return created;
  });
}
