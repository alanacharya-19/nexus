import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { mapArtifact } from '../db/mappers.js';
import type { Artifact, ArtifactKind } from '@nexus/shared';

export async function createArtifact(input: {
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
}): Promise<Artifact> {
  const result = await query(
    `INSERT INTO artifacts
      (id, run_id, user_id, name, kind, mime_type, content, version, created_by_agent_id, agent_name, step_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      randomUUID(),
      input.runId,
      input.userId,
      input.name,
      input.kind,
      input.mimeType,
      input.content,
      input.version,
      input.createdByAgentId,
      input.agentName,
      input.stepId,
    ]
  );
  return mapArtifact(result.rows[0]!);
}

export async function listArtifactsForRun(runId: string): Promise<Artifact[]> {
  const result = await query(
    'SELECT * FROM artifacts WHERE run_id = $1 ORDER BY created_at ASC',
    [runId]
  );
  return result.rows.map(mapArtifact);
}

export async function listRecentArtifacts(
  userId: string,
  limit = 50
): Promise<Artifact[]> {
  const result = await query(
    `SELECT a.*, r.title AS run_title
     FROM artifacts a JOIN runs r ON r.id = a.run_id
     WHERE a.user_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map((row) => ({
    ...mapArtifact(row),
    runTitle: row.run_title,
  })) as (Artifact & { runTitle: string })[];
}

export async function getArtifact(userId: string, artifactId: string): Promise<Artifact | null> {
  const result = await query(
    `SELECT a.*, r.title AS run_title
     FROM artifacts a JOIN runs r ON r.id = a.run_id
     WHERE a.user_id = $1 AND a.id = $2`,
    [userId, artifactId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...mapArtifact(row), runTitle: row.run_title } as Artifact & {
    runTitle: string;
  };
}

export async function countArtifactVersions(
  runId: string,
  kind: ArtifactKind,
  stepId: string | null
): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM artifacts
     WHERE run_id = $1 AND kind = $2 AND (step_id IS NOT DISTINCT FROM $3)`,
    [runId, kind, stepId]
  );
  return Number(result.rows[0]?.count ?? '0');
}

export async function deleteArtifact(userId: string, artifactId: string): Promise<boolean> {
  const result = await query('DELETE FROM artifacts WHERE user_id = $1 AND id = $2', [
    userId,
    artifactId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
