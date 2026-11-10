import type { ProviderId } from '@nexus/shared';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerationRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  json?: boolean;
  signal?: AbortSignal;
}

export type ProviderStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; estimated: boolean }
  | { type: 'done'; finishReason: string | null };

export interface ProviderAdapter {
  readonly provider: ProviderId;
  stream(request: GenerationRequest): AsyncGenerator<ProviderStreamEvent>;
  validateKey(): Promise<{ ok: boolean; message?: string }>;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  estimatedUsage: boolean;
  finishReason: string | null;
}

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    provider: ProviderId,
    status: number,
    code: string,
    message: string,
    retryable?: boolean
  ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.retryable =
      retryable ??
      [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (typeof error === 'object' && error !== null && 'name' in error && String((error as { name: unknown }).name) === 'AbortError')
  );
}

export function networkError(provider: ProviderId, error: unknown): ProviderError {
  const message =
    error instanceof Error ? error.message : 'Network request to the provider failed';
  return new ProviderError(provider, 0, 'NETWORK_ERROR', message, true);
}
