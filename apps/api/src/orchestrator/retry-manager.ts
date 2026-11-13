import { ProviderError, isAbortError } from '../providers/types.js';

export interface RetryOptions {
  /** Total attempts, including the first one. */
  attempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void | Promise<void>;
}

export interface StepAttempt {
  attempts: number;
}

const NON_RETRYABLE_CODES = new Set([
  'VALIDATION_ERROR',
  'PROVIDER_NOT_CONFIGURED',
  'INVALID_STATE',
  'EXECUTION_LIMIT',
  'AI_INVALID_OUTPUT',
]);

function isRetryable(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof ProviderError) return error.retryable;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && NON_RETRYABLE_CODES.has(code)) return false;
    if (code === 'UND_ERR_SOCKET' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
      return true;
    }
  }
  // Unknown failures are treated as transient once. A second failure fails the
  // stage, which keeps provider bugs from looping forever.
  return true;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Bounded retries for idempotent orchestration operations. Provider streaming
 * retries are handled by the provider service; this manager adds a second,
 * explicit ceiling around a whole stage step and stops completed steps from
 * being re-run.
 */
export class RetryManager {
  constructor(
    private readonly defaultAttempts = 2,
    private readonly defaultBaseDelayMs = 600
  ) {}

  canRetry(error: unknown, attempt: StepAttempt, maxAttempts = this.defaultAttempts): boolean {
    if (isAbortError(error)) return false;
    if (!isRetryable(error)) return false;
    return attempt.attempts < maxAttempts;
  }

  delayFor(attempt: number, baseDelayMs = this.defaultBaseDelayMs): number {
    return Math.min(8_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  }

  async execute<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const attempts = Math.max(1, options.attempts ?? this.defaultAttempts);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (options.signal?.aborted) throw new Error('Aborted');
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt >= attempts) throw error;
        const delayMs = this.delayFor(attempt, options.baseDelayMs);
        await options.onRetry?.(attempt, error, delayMs);
        await sleep(delayMs, options.signal);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Operation failed');
  }

  /** Mark a subtask attempt and answer whether another provider call is allowed. */
  claimAttempt(step: { attempts?: number; status?: string }, maxAttempts = this.defaultAttempts):
    | { allowed: true; attempts: number }
    | { allowed: false; attempts: number } {
    const attempts = (step.attempts ?? 0) + 1;
    if (step.status === 'done') return { allowed: false, attempts: step.attempts ?? 0 };
    return { allowed: attempts <= maxAttempts, attempts };
  }
}
