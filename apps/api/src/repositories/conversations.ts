import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { iso, mapConversation } from '../db/mappers.js';
import type { Conversation, ProviderId } from '@nexus/shared';

const SELECT_CONVERSATION = `
  SELECT c.*,
         p.name AS project_name,
         (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id)::int AS message_count,
         (SELECT nullif(m.content, '')
            FROM messages m
           WHERE m.conversation_id = c.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1) AS last_message
    FROM conversations c
    LEFT JOIN projects p ON p.id = c.project_id`;

export async function createConversation(input: {
  userId: string;
  title: string;
  projectId: string | null;
  provider: ProviderId;
  model: string;
}): Promise<Conversation> {
  const result = await query(
    `INSERT INTO conversations (id, user_id, project_id, title, provider, model)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      randomUUID(),
      input.userId,
      input.projectId,
      input.title,
      input.provider,
      input.model,
    ]
  );
  return mapConversation(result.rows[0]!);
}

export async function getConversation(
  userId: string,
  conversationId: string
): Promise<Conversation | null> {
  const result = await query(
    `${SELECT_CONVERSATION} WHERE c.user_id = $1 AND c.id = $2`,
    [userId, conversationId]
  );
  const row = result.rows[0];
  return row ? mapConversation(row) : null;
}

export async function listConversations(
  userId: string,
  filters: {
    projectId?: string;
    search?: string;
    limit: number;
    cursor?: string;
  }
): Promise<{ items: Conversation[]; nextCursor: string | null }> {
  const conditions = ['c.user_id = $1'];
  const values: unknown[] = [userId];
  let index = 2;

  if (filters.projectId) {
    conditions.push(`c.project_id = $${index}`);
    values.push(filters.projectId);
    index += 1;
  }
  if (filters.search) {
    conditions.push(`c.title ILIKE $${index}`);
    values.push(`%${filters.search}%`);
    index += 1;
  }
  if (filters.cursor) {
    conditions.push(`c.updated_at < $${index}`);
    values.push(filters.cursor);
    index += 1;
  }

  values.push(filters.limit + 1);
  const result = await query(
    `${SELECT_CONVERSATION}
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT $${index}`,
    values
  );

  const rows = result.rows.slice(0, filters.limit);
  const items = rows.map(mapConversation);
  const nextCursor =
    result.rows.length > filters.limit
      ? (iso(rows[rows.length - 1]?.updated_at) ?? null)
      : null;
  return { items, nextCursor };
}

const CONVERSATION_COLUMNS: Record<string, string> = {
  title: 'title',
  projectId: 'project_id',
  provider: 'provider',
  model: 'model',
};

export async function updateConversation(
  userId: string,
  conversationId: string,
  patch: Partial<{
    title: string;
    projectId: string | null;
    provider: ProviderId;
    model: string;
  }>
): Promise<Conversation | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  for (const [key, column] of Object.entries(CONVERSATION_COLUMNS)) {
    if (patch[key as keyof typeof patch] !== undefined) {
      sets.push(`${column} = $${index}`);
      values.push(patch[key as keyof typeof patch]);
      index += 1;
    }
  }
  if (sets.length === 0) return getConversation(userId, conversationId);

  sets.push('updated_at = now()');
  values.push(userId, conversationId);
  const result = await query(
    `UPDATE conversations SET ${sets.join(', ')}
      WHERE user_id = $${index} AND id = $${index + 1}
      RETURNING *`,
    values
  );
  const row = result.rows[0];
  return row ? mapConversation(row) : null;
}

export async function touchConversation(conversationId: string): Promise<void> {
  await query('UPDATE conversations SET updated_at = now() WHERE id = $1', [
    conversationId,
  ]);
}

export async function deleteConversation(
  userId: string,
  conversationId: string
): Promise<boolean> {
  const result = await query(
    'DELETE FROM conversations WHERE user_id = $1 AND id = $2',
    [userId, conversationId]
  );
  return (result.rowCount ?? 0) > 0;
}
