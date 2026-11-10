import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.js';
import { mapTemplate } from '../db/mappers.js';
import {
  BUILTIN_TEMPLATES,
  type ApprovalMode,
  type WorkflowTemplate,
} from '@nexus/shared';

function builtinToTemplate(): WorkflowTemplate[] {
  return BUILTIN_TEMPLATES.map((template) => ({
    ...template,
    userId: null,
    isBuiltin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

export async function listTemplates(userId: string): Promise<WorkflowTemplate[]> {
  const result = await query(
    'SELECT * FROM templates WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return [...builtinToTemplate(), ...result.rows.map(mapTemplate)];
}

export async function getTemplate(
  userId: string,
  templateId: string
): Promise<WorkflowTemplate | null> {
  const builtin = builtinToTemplate().find((template) => template.id === templateId);
  if (builtin) return builtin;

  const result = await query('SELECT * FROM templates WHERE user_id = $1 AND id = $2', [
    userId,
    templateId,
  ]);
  const row = result.rows[0];
  return row ? mapTemplate(row) : null;
}

export async function createTemplate(
  userId: string,
  input: {
    name: string;
    description: string;
    category: string;
    icon: string;
    objectiveTemplate: string;
    guidance: string;
    suggestedApprovalMode: ApprovalMode;
  }
): Promise<WorkflowTemplate> {
  const result = await query(
    `INSERT INTO templates
      (id, user_id, name, description, category, icon, objective_template, guidance, suggested_approval_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      randomUUID(),
      userId,
      input.name,
      input.description,
      input.category,
      input.icon,
      input.objectiveTemplate,
      input.guidance,
      input.suggestedApprovalMode,
    ]
  );
  return mapTemplate(result.rows[0]!);
}

export async function deleteTemplate(userId: string, templateId: string): Promise<boolean> {
  const result = await query('DELETE FROM templates WHERE user_id = $1 AND id = $2', [
    userId,
    templateId,
  ]);
  return (result.rowCount ?? 0) > 0;
}
