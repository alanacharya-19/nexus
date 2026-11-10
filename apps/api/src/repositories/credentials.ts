import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { iso } from '../db/mappers.js';
import type { ProviderId } from '@nexus/shared';

export interface CredentialRow {
  id: string;
  userId: string;
  provider: ProviderId;
  encryptedKey: string;
  keyHint: string;
  lastValidatedAt: string | null;
}

function mapCredential(row: Record<string, any>): CredentialRow {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    encryptedKey: row.encrypted_key,
    keyHint: row.key_hint,
    lastValidatedAt: iso(row.last_validated_at),
  };
}

export async function getCredential(
  userId: string,
  provider: ProviderId
): Promise<CredentialRow | null> {
  const result = await query('SELECT * FROM credentials WHERE user_id = $1 AND provider = $2', [
    userId,
    provider,
  ]);
  const row = result.rows[0];
  return row ? mapCredential(row) : null;
}

export async function listCredentials(userId: string): Promise<CredentialRow[]> {
  const result = await query(
    'SELECT * FROM credentials WHERE user_id = $1 ORDER BY provider ASC',
    [userId]
  );
  return result.rows.map(mapCredential);
}

export async function upsertCredential(
  userId: string,
  provider: ProviderId,
  encryptedKey: string,
  keyHint: string
): Promise<CredentialRow> {
  const result = await query(
    `INSERT INTO credentials (id, user_id, provider, encrypted_key, key_hint, last_validated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (user_id, provider) DO UPDATE
       SET encrypted_key = EXCLUDED.encrypted_key,
           key_hint = EXCLUDED.key_hint,
           last_validated_at = now(),
           updated_at = now()
     RETURNING *`,
    [randomUUID(), userId, provider, encryptedKey, keyHint]
  );
  return mapCredential(result.rows[0]!);
}

export async function deleteCredential(
  userId: string,
  provider: ProviderId
): Promise<boolean> {
  const result = await query('DELETE FROM credentials WHERE user_id = $1 AND provider = $2', [
    userId,
    provider,
  ]);
  return (result.rowCount ?? 0) > 0;
}
