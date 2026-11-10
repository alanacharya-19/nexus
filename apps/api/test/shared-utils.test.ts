import { describe, expect, it } from 'vitest';
import {
  clamp,
  estimateTokens,
  extractJsonValue,
  formatCost,
  formatDuration,
  formatTokens,
  titleFromObjective,
  truncate,
} from '@nexus/shared';

describe('extractJsonValue', () => {
  it('parses a plain JSON object', () => {
    expect(extractJsonValue('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON wrapped in markdown fences and prose', () => {
    const raw = 'Here is the plan:\n```json\n{"summary":"ok","steps":[]}\n```\nDone.';
    expect(extractJsonValue(raw)).toEqual({ summary: 'ok', steps: [] });
  });

  it('handles braces and brackets inside strings', () => {
    const raw = '{"note":"use {curly} and [square] carefully","ok":true}';
    expect(extractJsonValue(raw)).toEqual({
      note: 'use {curly} and [square] carefully',
      ok: true,
    });
  });

  it('handles escaped quotes inside strings', () => {
    const raw = '{"note":"he said \\"hello\\"","ok":true}';
    expect(extractJsonValue(raw)).toEqual({ note: 'he said "hello"', ok: true });
  });

  it('parses top-level arrays', () => {
    expect(extractJsonValue('Result: [1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('throws when there is no JSON value', () => {
    expect(() => extractJsonValue('no structured data here')).toThrow(
      /No JSON object/
    );
  });

  it('throws on incomplete JSON', () => {
    expect(() => extractJsonValue('{"a": 1')).toThrow(/incomplete JSON/);
  });
});

describe('formatting helpers', () => {
  it('formats costs with precision that scales with magnitude', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(-1)).toBe('$0.00');
    expect(formatCost(0.0042)).toBe('$0.0042');
    expect(formatCost(0.42)).toBe('$0.420');
    expect(formatCost(12.345)).toBe('$12.35');
  });

  it('formats token counts compactly', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1_500)).toBe('1.5k');
    expect(formatTokens(150_000)).toBe('150k');
    expect(formatTokens(2_500_000)).toBe('2.50M');
  });

  it('formats durations from milliseconds to hours', () => {
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(1_500)).toBe('2s');
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(3_600_000)).toBe('1h 0m');
  });

  it('truncates with an ellipsis without exceeding the limit', () => {
    expect(truncate('short', 10)).toBe('short');
    const result = truncate('a'.repeat(50), 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.endsWith('…')).toBe(true);
  });

  it('derives a concise run title from the objective', () => {
    expect(titleFromObjective('  # Build a launch plan  ')).toBe('Build a launch plan');
    expect(titleFromObjective('')).toBe('Untitled run');
    expect(titleFromObjective('x'.repeat(100)).length).toBeLessThanOrEqual(72);
  });

  it('estimates tokens and clamps numbers', () => {
    expect(estimateTokens('')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
  });
});
