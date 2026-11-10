import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { mapUser } from '../db/mappers.js';
import type { User } from '@nexus/shared';

export async function upsertUser(input: {
  id?: string;
  email: string;
  name?: string | null;
}): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const id = input.id ?? randomUUID();

  const result = await query(
    `INSERT INTO users (id, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, users.name),
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
