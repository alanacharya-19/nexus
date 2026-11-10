import type { ProviderId } from '@nexus/shared';
import { assertOk, parseSse } from './sse.js';
import {
  networkError,
  ProviderError,
  type GenerationRequest,
  type ProviderAdapter,
  type ProviderStreamEvent,
} from './types.js';

export class GoogleAdapter implements ProviderAdapter {
  readonly provider: ProviderId = 'google';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  async *stream(request: GenerationRequest): AsyncGenerator<ProviderStreamEvent> {
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(
      request.model
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
            ...(request.json ? { responseMimeType: 'application/json' } : {}),
          },
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

      if (payload.error) {
        throw new ProviderError(
          this.provider,
          Number(payload.error.code ?? 502),
          String(payload.error.status ?? 'PROVIDER_ERROR'),
          String(payload.error.message ?? 'Gemini returned an error'),
          true
        );
      }

      const candidate = payload.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part?.thought) continue;
          if (typeof part?.text === 'string' && part.text.length > 0) {
            yield { type: 'delta', text: part.text };
          }
        }
      }
      if (candidate?.finishReason) finishReason = String(candidate.finishReason);

      if (payload.usageMetadata) {
        usageSeen = true;
        inputTokens = Number(payload.usageMetadata.promptTokenCount ?? 0);
        outputTokens = Number(payload.usageMetadata.candidatesTokenCount ?? 0);
      }
    }

    yield { type: 'usage', inputTokens, outputTokens, estimated: !usageSeen };
    yield { type: 'done', finishReason };
  }

  async validateKey(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`
      );
      if (response.ok) return { ok: true };
      const message =
        response.status === 400 || response.status === 403
          ? 'Google rejected this key.'
          : `Google returned ${response.status}.`;
      return { ok: false, message };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Could not reach Google.',
      };
    }
  }
}
