import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { mapProject } from '../db/mappers.js';
import type { Project } from '@nexus/shared';

export async function listProjects(userId: string): Promise<Project[]> {
  const result = await query(
    `SELECT p.*, (SELECT count(*) FROM runs r WHERE r.project_id = p.id)::int AS run_count
     FROM projects p
     WHERE p.user_id = $1
     ORDER BY p.updated_at DESC`,
    [userId]
  );
  return result.rows.map(mapProject);
}

export async function getProject(userId: string, projectId: string): Promise<Project | null> {
  const result = await query('SELECT * FROM projects WHERE user_id = $1 AND id = $2', [
    userId,
    projectId,
  ]);
  const row = result.rows[0];
  return row ? mapProject(row) : null;
}

export async function createProject(
  userId: string,
  input: { name: string; description?: string | null; color: string }
): Promise<Project> {
  const result = await query(
    `INSERT INTO projects (id, user_id, name, description, color)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [randomUUID(), userId, input.name, input.description ?? null, input.color]
  );
  return mapProject(result.rows[0]!);
}

export async function updateProject(
  userId: string,
  projectId: string,
  patch: { name?: string; description?: string | null; color?: string }
): Promise<Project | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;
  for (const [key, column] of [
    ['name', 'name'],
    ['description', 'description'],
    ['color', 'color'],
  ] as const) {
    if (patch[key] !== undefined) {
      sets.push(`${column} = $${index}`);
      values.push(patch[key]);
      index += 1;
    }
  }
  if (sets.length === 0) return getProject(userId, projectId);
  sets.push('updated_at = now()');
  values.push(userId, projectId);
  const result = await query(
    `UPDATE projects SET ${sets.join(', ')} WHERE user_id = $${index} AND id = $${index + 1} RETURNING *`,
    values
  );
  const row = result.rows[0];
  return row ? mapProject(row) : null;
}

export async function deleteProject(userId: string, projectId: string): Promise<boolean> {
  const result = await query('DELETE FROM projects WHERE user_id = $1 AND id = $2', [
    userId,
    projectId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
