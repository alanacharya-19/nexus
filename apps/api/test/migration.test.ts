import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../migrations/002_conversations.sql', import.meta.url),
  'utf8'
);
const normalised = sql.replace(/\s+/g, ' ');

describe('002_conversations migration', () => {
  it('creates conversations owned by a user with provider/model validation', () => {
    expect(normalised).toContain('CREATE TABLE IF NOT EXISTS conversations');
    expect(normalised).toContain(
      'user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE'
    );
    expect(normalised).toContain(
      "provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google'))"
    );
    expect(normalised).toContain('model text NOT NULL');
  });

  it('creates messages linked to conversations and users', () => {
    expect(normalised).toContain('CREATE TABLE IF NOT EXISTS messages');
    expect(normalised).toContain(
      'conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE'
    );
    expect(normalised).toContain('user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE');
    expect(normalised).toContain(
      "role text NOT NULL CHECK (role IN ('system', 'user', 'assistant'))"
    );
    expect(normalised).toContain("metadata jsonb NOT NULL DEFAULT '{}'::jsonb");
  });

  it('indexes conversation and message history access paths', () => {
    expect(normalised).toContain(
      'CREATE INDEX IF NOT EXISTS conversations_user_updated_idx ON conversations (user_id, updated_at DESC)'
    );
    expect(normalised).toContain(
      'CREATE INDEX IF NOT EXISTS conversations_project_idx ON conversations (project_id, updated_at DESC)'
    );
    expect(normalised).toContain(
      'CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages (conversation_id, created_at ASC, id ASC)'
    );
    expect(normalised).toContain(
      'CREATE INDEX IF NOT EXISTS messages_streaming_idx ON messages ((metadata ->> \'status\')) WHERE role = \'assistant\''
    );
  });

  it('links usage records to conversations/messages and distinguishes estimates', () => {
    expect(normalised).toContain(
      'ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL'
    );
    expect(normalised).toContain(
      'ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES messages(id) ON DELETE SET NULL'
    );
    expect(normalised).toContain(
      "ADD COLUMN IF NOT EXISTS usage_source text NOT NULL DEFAULT 'estimated' CHECK (usage_source IN ('provider', 'estimated'))"
    );
    expect(normalised).toContain(
      'ADD COLUMN IF NOT EXISTS cost_estimated boolean NOT NULL DEFAULT true'
    );
    expect(normalised).toContain(
      'CREATE INDEX IF NOT EXISTS usage_conversation_idx ON usage_records (conversation_id, created_at DESC)'
    );
  });

  it('adds AI preferences and the requested project aliases', () => {
    expect(normalised).toContain('ALTER TABLE users ADD COLUMN IF NOT EXISTS default_provider');
    expect(normalised).toContain('ALTER TABLE users ADD COLUMN IF NOT EXISTS default_model');
    expect(normalised).toContain(
      'ALTER TABLE projects ADD COLUMN IF NOT EXISTS title text GENERATED ALWAYS AS (name) STORED'
    );
    expect(normalised).toContain(
      "ALTER TABLE projects ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'"
    );
  });

  it('exposes executions/execution_events as compatibility views over runs', () => {
    expect(normalised).toContain('CREATE OR REPLACE VIEW executions AS SELECT id, user_id, project_id, status');
    expect(normalised).toContain('FROM runs');
    expect(normalised).toContain('CREATE OR REPLACE VIEW execution_events AS SELECT id, run_id AS execution_id');
    expect(normalised).toContain('FROM run_events');
  });

  it('enables RLS on every user-owned table including conversations and messages', () => {
    for (const table of [
      'users',
      'projects',
      'agents',
      'templates',
      'runs',
      'run_events',
      'artifacts',
      'usage_records',
      'credentials',
      'run_instructions',
      'conversations',
      'messages',
    ]) {
      expect(normalised).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it('scopes conversation and message policies to auth.uid()', () => {
    expect(normalised).toContain(
      'CREATE POLICY conversations_own ON conversations FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())'
    );
    expect(normalised).toContain(
      'CREATE POLICY messages_own ON messages FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())'
    );
  });

  it('derives child row ownership from the parent run instead of trusting the client', () => {
    expect(normalised).toContain('CREATE POLICY run_events_own ON run_events FOR ALL USING (');
    expect(normalised).toContain('FROM runs r WHERE r.id = run_events.run_id AND r.user_id = auth.uid()');
    expect(normalised).toContain(
      'CREATE POLICY run_instructions_own ON run_instructions FOR ALL USING ('
    );
  });

  it('keeps encrypted credentials inaccessible to client roles', () => {
    expect(normalised).toContain('ALTER TABLE credentials ENABLE ROW LEVEL SECURITY');
    expect(normalised).not.toMatch(/CREATE POLICY\s+credentials_/i);
  });

  it('installs a portable auth.uid() fallback when Supabase is absent', () => {
    expect(normalised).toContain("WHERE n.nspname = 'auth' AND p.proname = 'uid'");
    expect(normalised).toContain('CREATE FUNCTION auth.uid() RETURNS uuid');
    expect(normalised).toContain("AS 'SELECT NULL::uuid'");
  });
});
