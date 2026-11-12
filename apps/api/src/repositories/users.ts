import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { mapUser } from '../db/mappers.js';
import type { AiPreferences, ProviderId, User } from '@nexus/shared';

export async function upsertUser(input: {
  id?: string;
  email: string;
  name?: string | null;
}): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const id = input.id ?? randomUUID();

  const result = await query(
    `INSERT INTO users (id, email, name, display_name)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (email) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, users.name),
           display_name = COALESCE(EXCLUDED.display_name, users.display_name),
           updated_at = now()
     RETURNING *`,
    [id, email, input.name ?? null]
  );

  return mapUser(result.rows[0]!);
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

export async function getAiPreferences(userId: string): Promise<AiPreferences> {
  const result = await query<{
    default_provider: ProviderId | null;
    default_model: string | null;
  }>('SELECT default_provider, default_model FROM users WHERE id = $1', [userId]);
  const row = result.rows[0];
  return {
    defaultProvider: row?.default_provider ?? null,
    defaultModel: row?.default_model ?? null,
  };
}

export async function updateAiPreferences(
  userId: string,
  input: AiPreferences
): Promise<AiPreferences> {
  const result = await query<{
    default_provider: ProviderId | null;
    default_model: string | null;
  }>(
    `UPDATE users
     SET default_provider = $2,
         default_model = $3,
         updated_at = now()
     WHERE id = $1
     RETURNING default_provider, default_model`,
    [userId, input.defaultProvider, input.defaultModel]
  );
  const row = result.rows[0];
  return {
    defaultProvider: row?.default_provider ?? null,
    defaultModel: row?.default_model ?? null,
  };
}
