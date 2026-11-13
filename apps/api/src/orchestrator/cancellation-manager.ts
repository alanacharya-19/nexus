import type { Run } from '@nexus/shared';
import { AppError } from '../errors.js';

export type ControlMode = 'run' | 'steer' | 'pause' | 'cancel';

export interface RunControl {
  abort: AbortController;
  mode: ControlMode;
  startedAt: number;
}

export class ExecutionLimitError extends AppError {
  constructor(message: string) {
    super(422, 'EXECUTION_LIMIT', message);
    this.name = 'ExecutionLimitError';
  }
}

/**
 * Owns the abort signal for every in-flight run. Pause, cancel, and steering
 * all travel through this single object, so a provider call can never keep
 * running after the operator has stopped the pipeline.
 */
export class CancellationManager {
  private controls = new Map<string, RunControl>();

  create(runId: string): RunControl {
    const control: RunControl = {
      abort: new AbortController(),
      mode: 'run',
      startedAt: Date.now(),
    };
    this.controls.set(runId, control);
    return control;
  }

  get(runId: string): RunControl | null {
    return this.controls.get(runId) ?? null;
  }

  has(runId: string): boolean {
    return this.controls.has(runId);
  }

  mode(runId: string): ControlMode | null {
    return this.controls.get(runId)?.mode ?? null;
  }

  signal(runId: string): AbortSignal | null {
    return this.controls.get(runId)?.abort.signal ?? null;
  }

  /** Abort the current provider call while keeping the run schedulable. */
  steer(runId: string): boolean {
    const control = this.controls.get(runId);
    if (!control) return false;
    control.mode = 'steer';
    control.abort.abort();
    return true;
  }

  pause(runId: string): boolean {
    const control = this.controls.get(runId);
    if (!control) return false;
    control.mode = 'pause';
    control.abort.abort();
    return true;
  }

  cancel(runId: string): boolean {
    const control = this.controls.get(runId);
    if (!control) return false;
    control.mode = 'cancel';
    control.abort.abort();
    return true;
  }

  /** Replace an aborted signal after a steering checkpoint. */
  reset(runId: string): RunControl | null {
    const control = this.controls.get(runId);
    if (!control) return null;
    control.mode = 'run';
    control.abort = new AbortController();
    control.startedAt = Date.now();
    return control;
  }

  release(runId: string): void {
    this.controls.delete(runId);
  }

  get activeCount(): number {
    return this.controls.size;
  }

  isCancelledOrPaused(runId: string): boolean {
    const mode = this.mode(runId);
    return mode === 'cancel' || mode === 'pause';
  }

  /**
   * Hard ceiling for a single execution. Checked between every agent call and
   * again before continuing a stage, so a slow provider cannot run forever.
   */
  assertWithinDuration(run: Run, now = Date.now()): void {
    if (!run.executionStartedAt) return;
    const startedAt = Date.parse(run.executionStartedAt);
    if (!Number.isFinite(startedAt)) return;
    const elapsed = now - startedAt;
    if (elapsed > run.maxDurationMs) {
      throw new ExecutionLimitError(
        `Execution exceeded its ${Math.round(run.maxDurationMs / 1_000)}s limit.`
      );
    }
  }
}
