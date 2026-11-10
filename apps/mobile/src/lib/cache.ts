import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

/**
 * Small persistence layer. Native uses Expo SQLite (real on-device storage,
 * survives restarts, works offline). Web falls back to localStorage because
 * SQLite on web needs a WASM setup that is not worth the payload here.
 */

let database: SQLite.SQLiteDatabase | null = null;

function db(): SQLite.SQLiteDatabase | null {
  if (Platform.OS === 'web') return null;
  if (database) return database;
  try {
    database = SQLite.openDatabaseSync('nexus.db');
    database.execSync(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY NOT NULL,
        objective TEXT NOT NULL,
        title TEXT,
        project_id TEXT,
        template_id TEXT,
        approval_mode TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    return database;
  } catch {
    return null;
  }
}

function web(): Storage | null {
  if (Platform.OS !== 'web') return null;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return web()?.getItem(`nexus.cache.${key}`) ?? null;
  try {
    const row = db()?.getFirstSync<{ value: string }>(
      'SELECT value FROM kv WHERE key = ?',
      key
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    web()?.setItem(`nexus.cache.${key}`, value);
    return;
  }
  try {
    db()?.runSync(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      value,
      new Date().toISOString()
    );
  } catch {
    // Cache failures must never break the app.
  }
}

export async function cacheDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    web()?.removeItem(`nexus.cache.${key}`);
    return;
  }
  try {
    db()?.runSync('DELETE FROM kv WHERE key = ?', key);
  } catch {
    // Ignore.
  }
}

export interface Draft {
  id: string;
  objective: string;
  title: string | null;
  projectId: string | null;
  templateId: string | null;
  approvalMode: string;
  updatedAt: string;
}

export async function saveDraft(draft: Draft): Promise<void> {
  if (Platform.OS === 'web') {
    const list = await listDrafts();
    const next = [draft, ...list.filter((item) => item.id !== draft.id)].slice(0, 12);
    web()?.setItem('nexus.drafts', JSON.stringify(next));
    return;
  }
  try {
    db()?.runSync(
      `INSERT INTO drafts (id, objective, title, project_id, template_id, approval_mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         objective = excluded.objective,
         title = excluded.title,
         project_id = excluded.project_id,
         template_id = excluded.template_id,
         approval_mode = excluded.approval_mode,
         updated_at = excluded.updated_at`,
      draft.id,
      draft.objective,
      draft.title,
      draft.projectId,
      draft.templateId,
      draft.approvalMode,
      draft.updatedAt
    );
  } catch {
    // Drafts are a convenience; losing one must not crash the composer.
  }
}

export async function listDrafts(): Promise<Draft[]> {
  if (Platform.OS === 'web') {
    try {
      return JSON.parse(web()?.getItem('nexus.drafts') ?? '[]') as Draft[];
    } catch {
      return [];
    }
  }
  try {
    const rows = db()?.getAllSync<{
      id: string;
      objective: string;
      title: string | null;
      project_id: string | null;
      template_id: string | null;
      approval_mode: string;
      updated_at: string;
    }>('SELECT * FROM drafts ORDER BY updated_at DESC LIMIT 12');
    return (rows ?? []).map((row) => ({
      id: row.id,
      objective: row.objective,
      title: row.title,
      projectId: row.project_id,
      templateId: row.template_id,
      approvalMode: row.approval_mode,
      updatedAt: row.updated_at,
    }));
  } catch {
    return [];
  }
}

export async function deleteDraft(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    const list = await listDrafts();
    web()?.setItem('nexus.drafts', JSON.stringify(list.filter((item) => item.id !== id)));
    return;
  }
  try {
    db()?.runSync('DELETE FROM drafts WHERE id = ?', id);
  } catch {
    // Ignore.
  }
}
