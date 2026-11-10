import type {
  CredentialStatus,
  ProviderId,
  UsageRecord,
} from '@nexus/shared';
import { estimateTokens, PROVIDERS } from '@nexus/shared';
import { config } from '../config.js';
import { Errors } from '../errors.js';
import { decryptSecret, encryptSecret, keyHint } from '../security/crypto.js';
import {
  getCredential,
  listCredentials,
  upsertCredential,
  deleteCredential,
} from '../repositories/credentials.js';
import { AnthropicAdapter } from './anthropic.js';
import { GoogleAdapter } from './google.js';
import { OpenAIAdapter } from './openai.js';
import {
  isAbortError,
  networkError,
  ProviderError,
  type CompletionResult,
  type GenerationRequest,
  type ProviderAdapter,
  type ProviderStreamEvent,
} from './types.js';

export function createAdapter(provider: ProviderId, apiKey: string): ProviderAdapter {
  switch (provider) {
    case 'openai':
      return new OpenAIAdapter(apiKey, config.baseUrls.openai);
    case 'anthropic':
      return new AnthropicAdapter(apiKey, config.baseUrls.anthropic);
    case 'google':
      return new GoogleAdapter(apiKey, config.baseUrls.google);
  }
}

export async function getProviderKey(
  userId: string,
  provider: ProviderId
): Promise<{ key: string; source: 'user' | 'server' }> {
  const credential = await getCredential(userId, provider);
  if (credential) {
    return { key: decryptSecret(credential.encryptedKey), source: 'user' };
  }
  const serverKey = config.providerKeys[provider];
  if (serverKey) return { key: serverKey, source: 'server' };
  throw Errors.providerNotConfigured(provider);
}

export async function getAdapterForUser(
  userId: string,
  provider: ProviderId
): Promise<ProviderAdapter> {
  const { key } = await getProviderKey(userId, provider);
  return createAdapter(provider, key);
}

export async function getConfiguredProviders(userId: string): Promise<ProviderId[]> {
  const credentials = await listCredentials(userId);
  const userProviders = new Set(credentials.map((credential) => credential.provider));
  return PROVIDERS.filter(
    (provider) => userProviders.has(provider) || Boolean(config.providerKeys[provider])
  );
}

export async function getCredentialStatuses(userId: string): Promise<CredentialStatus[]> {
  const credentials = await listCredentials(userId);
  const byProvider = new Map(credentials.map((credential) => [credential.provider, credential]));

  return PROVIDERS.map((provider) => {
    const credential = byProvider.get(provider);
    if (credential) {
      return {
        provider,
        configured: true,
        source: 'user',
        hint: credential.keyHint,
        lastValidatedAt: credential.lastValidatedAt,
      };
    }
    if (config.providerKeys[provider]) {
      return {
        provider,
        configured: true,
        source: 'server',
        hint: null,
        lastValidatedAt: null,
      };
    }
    return {
      provider,
      configured: false,
      source: null,
      hint: null,
      lastValidatedAt: null,
    };
  });
}

export async function saveUserCredential(
  userId: string,
  provider: ProviderId,
  apiKey: string
): Promise<CredentialStatus> {
  const adapter = createAdapter(provider, apiKey);
  const validation = await adapter.validateKey();
  if (!validation.ok) {
    throw Errors.validation(
      validation.message ?? `The ${provider} key could not be validated.`
    );
  }

  await upsertCredential(userId, provider, encryptSecret(apiKey), keyHint(apiKey));
  const statuses = await getCredentialStatuses(userId);
  return statuses.find((status) => status.provider === provider)!;
}

export async function removeUserCredential(
  userId: string,
  provider: ProviderId
): Promise<void> {
  await deleteCredential(userId, provider);
}

export async function validateProviderKey(
  provider: ProviderId,
  apiKey: string
): Promise<{ ok: boolean; message?: string }> {
  return createAdapter(provider, apiKey).validateKey();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
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

export interface StreamOptions {
  signal?: AbortSignal;
  maxRetries?: number;
  timeoutMs?: number;
  onRetry?: (attempt: number, error: ProviderError) => void;
}

/**
 * Stream a completion with bounded exponential backoff. Retries only happen
 * before any text has been emitted, so users never see duplicated output.
 */
export async function* streamWithRetry(
  adapter: ProviderAdapter,
  request: GenerationRequest,
  options: StreamOptions = {}
): AsyncGenerator<ProviderStreamEvent> {
  const maxRetries = options.maxRetries ?? config.providerMaxRetries;
  const timeoutMs = options.timeoutMs ?? config.providerTimeoutMs;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (options.signal?.aborted) throw new Error('Aborted');

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let emitted = false;
    try {
      for await (const event of adapter.stream({ ...request, signal })) {
        if (event.type === 'delta' && event.text.length > 0) emitted = true;
        yield event;
        if (event.type === 'done') return;
      }
      return;
    } catch (error) {
      if (options.signal?.aborted) throw error;

      let providerError: ProviderError;
      if (error instanceof ProviderError) {
        providerError = error;
      } else if (isAbortError(error)) {
        providerError = new ProviderError(
          adapter.provider,
          0,
          'PROVIDER_TIMEOUT',
          'The provider took too long to respond.',
          true
        );
      } else {
        providerError = networkError(adapter.provider, error);
      }

      if (!emitted && providerError.retryable && attempt < maxRetries) {
        options.onRetry?.(attempt + 1, providerError);
        await delay(600 * 2 ** attempt + Math.floor(Math.random() * 250), options.signal);
        continue;
      }
      throw providerError;
    }
  }
}

export async function completeWithRetry(
  adapter: ProviderAdapter,
  request: GenerationRequest,
  options: StreamOptions = {}
): Promise<CompletionResult> {
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedUsage = false;
  let finishReason: string | null = null;

  for await (const event of streamWithRetry(adapter, request, options)) {
    if (event.type === 'delta') text += event.text;
    if (event.type === 'usage') {
      inputTokens = event.inputTokens;
      outputTokens = event.outputTokens;
      estimatedUsage = event.estimated;
    }
    if (event.type === 'done') finishReason = event.finishReason;
  }

  if (estimatedUsage || (inputTokens === 0 && outputTokens === 0)) {
    const promptText = [
      request.system,
      ...request.messages.map((message) => message.content),
    ].join('\n');
    inputTokens = estimateTokens(promptText);
    outputTokens = estimateTokens(text);
    estimatedUsage = true;
  }

  return { text, inputTokens, outputTokens, estimatedUsage, finishReason };
}

export function usageRecordForError(input: {
  provider: ProviderId;
  model: string;
  latencyMs: number;
  error: unknown;
}): Partial<UsageRecord> {
  return {
    provider: input.provider,
    model: input.model,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: input.latencyMs,
    status: 'error',
  };
}
