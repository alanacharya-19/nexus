import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../migrations/003_orchestration.sql', import.meta.url),
  'utf8'
);
const normalised = sql.replace(/\s+/g, ' ');

describe('003_orchestration migration', () => {
  it('adds the explicit execution state and guardrail columns to runs', () => {
    for (const column of [
      "execution_state text NOT NULL DEFAULT 'queued'",
      'max_review_rounds integer NOT NULL DEFAULT 3',
      'max_duration_ms bigint NOT NULL DEFAULT 1800000',
      'max_total_tokens bigint NOT NULL DEFAULT 500000',
      'max_cost_usd numeric(14, 6) NOT NULL DEFAULT 3',
      'current_agent_id text',
      'current_task text',
      "agent_states jsonb NOT NULL DEFAULT '{}'::jsonb",
      'execution_started_at timestamptz',
    ]) {
      expect(normalised).toContain(column);
    }
  });

  it('constrains execution_state to the supported pipeline states', () => {
    expect(normalised).toContain('runs_execution_state_check');
    for (const state of [
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
      'cancelled',
    ]) {
      expect(normalised).toContain(`'${state}'`);
    }
  });

  it('indexes execution state for queue and recovery scans', () => {
    expect(normalised).toContain(
      'CREATE INDEX IF NOT EXISTS runs_execution_state_idx ON runs (execution_state, updated_at DESC)'
    );
  });

  it('makes event emission idempotent through an optional dedupe key', () => {
    expect(normalised).toContain('ADD COLUMN IF NOT EXISTS event_key text');
    expect(normalised).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS run_events_dedupe_idx ON run_events (run_id, event_key) WHERE event_key IS NOT NULL'
    );
  });

  it('backfills legacy runs without overwriting an explicit state', () => {
    expect(normalised).toContain('UPDATE runs SET execution_state = CASE');
    expect(normalised).toContain("WHEN status = 'completed' THEN 'completed'");
    expect(normalised).toContain("WHEN stage = 'work' THEN 'executing'");
    expect(normalised).toContain("WHERE execution_state = 'queued'");
  });
});
