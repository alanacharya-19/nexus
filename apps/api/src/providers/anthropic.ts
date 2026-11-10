import type { ProviderId } from '@nexus/shared';
import { assertOk, parseSse } from './sse.js';
import {
  networkError,
  ProviderError,
  type GenerationRequest,
  type ProviderAdapter,
  type ProviderStreamEvent,
} from './types.js';

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider: ProviderId = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
  }

  async *stream(request: GenerationRequest): AsyncGenerator<ProviderStreamEvent> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          system: request.json
            ? `${request.system}\n\nReturn only valid JSON. Do not wrap it in markdown fences.`
            : request.system,
          messages: request.messages,
          stream: true,
        }),
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      throw networkError(this.provider, error);
    }

    await assertOk(response, this.provider);
    if (!response.body) {
      throw new ProviderError(this.provider, 0, 'EMPTY_STREAM', 'Provider returned no stream');
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let usageSeen = false;
    let finishReason: string | null = null;

    for await (const event of parseSse(response.body)) {
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }

      switch (payload.type) {
        case 'message_start': {
          if (payload.message?.usage?.input_tokens) {
            inputTokens = Number(payload.message.usage.input_tokens);
            usageSeen = true;
          }
          break;
        }
        case 'content_block_delta': {
          const text = payload.delta?.text;
          if (typeof text === 'string' && text.length > 0) {
            yield { type: 'delta', text };
          }
          break;
        }
        case 'message_delta': {
          if (payload.usage?.output_tokens) {
            outputTokens = Number(payload.usage.output_tokens);
            usageSeen = true;
          }
          if (payload.delta?.stop_reason) finishReason = String(payload.delta.stop_reason);
          break;
        }
        case 'error': {
          throw new ProviderError(
            this.provider,
            502,
            String(payload.error?.type ?? 'PROVIDER_ERROR'),
            String(payload.error?.message ?? 'Anthropic returned an error'),
            true
          );
        }
        default:
          break;
      }
    }

    yield { type: 'usage', inputTokens, outputTokens, estimated: !usageSeen };
    yield { type: 'done', finishReason };
  }

  async validateKey(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models?limit=1`, {
        headers: this.headers(),
      });
      if (response.ok) return { ok: true };
      const message =
        response.status === 401
          ? 'Anthropic rejected this key.'
          : `Anthropic returned ${response.status}.`;
      return { ok: false, message };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Could not reach Anthropic.',
      };
    }
  }
}
