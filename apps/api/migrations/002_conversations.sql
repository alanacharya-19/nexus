-- Day 2: direct conversations, streaming messages, AI preferences, and RLS.
--
-- The Day 1 schema models agent executions as `runs` / `run_events`. The
-- product brief also uses the words `executions` / `execution_events`, so this
-- migration exposes those shapes as read-only compatibility views. The
-- orchestration source of truth stays `runs`, which keeps Day 1 behaviour
-- intact while the requested names remain queryable.

-- ---------------------------------------------------------------------------
-- Reconcile requested columns with the Day 1 schema
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
UPDATE users SET display_name = name WHERE display_name IS NULL AND name IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS default_provider text
  CHECK (default_provider IN ('openai', 'anthropic', 'google'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_model text;

-- `projects.name` is the Day 1 column. `title` is a generated alias so both
-- names always agree, and `status` adds the lifecycle field from the brief.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS title text GENERATED ALWAYS AS (name) STORED;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google')),
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
  ON conversations (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversations_project_idx
  ON conversations (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS messages_user_idx
  ON messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_streaming_idx
  ON messages ((metadata ->> 'status'))
  WHERE role = 'assistant';

-- Usage rows can belong to a conversation message as well as a run.
ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;
ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS usage_source text NOT NULL DEFAULT 'estimated'
    CHECK (usage_source IN ('provider', 'estimated'));
ALTER TABLE usage_records
  ADD COLUMN IF NOT EXISTS cost_estimated boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS usage_conversation_idx
  ON usage_records (conversation_id, created_at DESC);

-- Compatibility views that match the names used in the Day 2 brief.
CREATE OR REPLACE VIEW executions AS
  SELECT
    id,
    user_id,
    project_id,
    status,
    review_round AS current_round,
    started_at,
    completed_at,
    created_at,
    updated_at
  FROM runs;

CREATE OR REPLACE VIEW execution_events AS
  SELECT
    id,
    run_id AS execution_id,
    agent_id,
    type AS event_type,
    payload,
    created_at
  FROM run_events;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The API uses a direct PostgreSQL connection and enforces ownership in every
-- query. RLS is defence-in-depth for clients that reach Supabase/PostgREST
-- directly. On plain PostgreSQL (no Supabase `auth` schema) a null-returning
-- `auth.uid()` is installed so the migration remains portable; the API role is
-- the table owner and therefore unaffected.
-- ---------------------------------------------------------------------------

DO $rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS 'SELECT NULL::uuid';
  END IF;
END
$rls$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- users: read and update only your own profile.
DROP POLICY IF EXISTS users_select_own ON users;
CREATE POLICY users_select_own ON users FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS users_update_own ON users;
CREATE POLICY users_update_own ON users FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS users_insert_own ON users;
CREATE POLICY users_insert_own ON users FOR INSERT WITH CHECK (auth.uid() = id);

-- Directly owned resources.
DROP POLICY IF EXISTS projects_own ON projects;
CREATE POLICY projects_own ON projects FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS agents_own ON agents;
CREATE POLICY agents_own ON agents FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS templates_own ON templates;
CREATE POLICY templates_own ON templates FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS runs_own ON runs;
CREATE POLICY runs_own ON runs FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS artifacts_own ON artifacts;
CREATE POLICY artifacts_own ON artifacts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS usage_records_own ON usage_records;
CREATE POLICY usage_records_own ON usage_records FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS conversations_own ON conversations;
CREATE POLICY conversations_own ON conversations FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS messages_own ON messages;
CREATE POLICY messages_own ON messages FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Child rows inherit ownership from their parent execution.
DROP POLICY IF EXISTS run_events_own ON run_events;
CREATE POLICY run_events_own ON run_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM runs r
      WHERE r.id = run_events.run_id AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM runs r
      WHERE r.id = run_events.run_id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS run_instructions_own ON run_instructions;
CREATE POLICY run_instructions_own ON run_instructions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM runs r
      WHERE r.id = run_instructions.run_id AND r.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM runs r
      WHERE r.id = run_instructions.run_id AND r.user_id = auth.uid()
    )
  );

-- credentials intentionally has RLS enabled with no client policy. Only the
-- service role / API connection (table owner) can read encrypted key material.
DROP POLICY IF EXISTS credentials_own ON credentials;
