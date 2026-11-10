import type { ProviderId } from '@nexus/shared';
import { assertOk, parseSse } from './sse.js';
import {
  networkError,
  ProviderError,
  type GenerationRequest,
  type ProviderAdapter,
  type ProviderStreamEvent,
} from './types.js';

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider: ProviderId = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
    };
  }

  async *stream(request: GenerationRequest): AsyncGenerator<ProviderStreamEvent> {
    const isReasoning = /^o\d/.test(request.model) || request.model.startsWith('gpt-5');
    const tokenField = isReasoning ? 'max_completion_tokens' : 'max_tokens';

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        signal: request.signal,
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.system },
            ...request.messages,
          ],
          ...(isReasoning ? {} : { temperature: request.temperature }),
          [tokenField]: request.maxTokens,
          stream: true,
          stream_options: { include_usage: true },
          ...(request.json ? { response_format: { type: 'json_object' } } : {}),
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
      if (event.data === '[DONE]') break;
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(event.data);
      } catch {
        continue;
      }

      if (payload.error) {
        throw new ProviderError(
          this.provider,
          502,
          String(payload.error.code ?? 'PROVIDER_ERROR'),
          String(payload.error.message ?? 'OpenAI returned an error'),
          true
        );
      }

      const choice = payload.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        yield { type: 'delta', text: delta };
      }
      if (choice?.finish_reason) finishReason = String(choice.finish_reason);

      if (payload.usage) {
        usageSeen = true;
        inputTokens = Number(payload.usage.prompt_tokens ?? 0);
        outputTokens = Number(payload.usage.completion_tokens ?? 0);
      }
    }

    yield { type: 'usage', inputTokens, outputTokens, estimated: !usageSeen };
    yield { type: 'done', finishReason };
  }

  async validateKey(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.headers(),
      });
      if (response.ok) return { ok: true };
      const message =
        response.status === 401
          ? 'OpenAI rejected this key.'
          : `OpenAI returned ${response.status}.`;
      return { ok: false, message };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Could not reach OpenAI.',
      };
    }
  }
}
