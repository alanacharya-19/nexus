-- Explicit multi-agent orchestration state, guardrails, per-agent status, and
-- idempotent execution events.

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS execution_state text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS max_review_rounds integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_duration_ms bigint NOT NULL DEFAULT 1800000,
  ADD COLUMN IF NOT EXISTS max_total_tokens bigint NOT NULL DEFAULT 500000,
  ADD COLUMN IF NOT EXISTS max_cost_usd numeric(14, 6) NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS current_agent_id text,
  ADD COLUMN IF NOT EXISTS current_task text,
  ADD COLUMN IF NOT EXISTS agent_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS execution_started_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'runs_execution_state_check'
  ) THEN
    ALTER TABLE runs
      ADD CONSTRAINT runs_execution_state_check
      CHECK (execution_state IN (
        'queued',
        'planning',
        'executing',
        'reviewing',
        'revising',
        'polishing',
        'awaiting_approval',
        'paused',
        'completed',
        'failed',
        'cancelled'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS runs_execution_state_idx
  ON runs (execution_state, updated_at DESC);

-- Execution events get an optional dedupe key. Retries and reconnects can then
-- replay a checkpoint without duplicating timeline entries.
ALTER TABLE run_events
  ADD COLUMN IF NOT EXISTS event_key text;

CREATE UNIQUE INDEX IF NOT EXISTS run_events_dedupe_idx
  ON run_events (run_id, event_key)
  WHERE event_key IS NOT NULL;

-- Existing runs predate execution_state; infer a sensible value from the
-- legacy status/stage pair so they remain resumable.
UPDATE runs
SET execution_state = CASE
  WHEN status = 'completed' THEN 'completed'
  WHEN status = 'failed' THEN 'failed'
  WHEN status = 'cancelled' THEN 'cancelled'
  WHEN status = 'paused' THEN 'paused'
  WHEN status = 'awaiting_approval' THEN 'awaiting_approval'
  WHEN status = 'queued' THEN 'queued'
  WHEN stage = 'plan' THEN 'planning'
  WHEN stage = 'work' THEN 'executing'
  WHEN stage = 'review' THEN 'reviewing'
  WHEN stage = 'revise' THEN 'revising'
  WHEN stage = 'polish' THEN 'polishing'
  ELSE 'executing'
END
WHERE execution_state = 'queued';
