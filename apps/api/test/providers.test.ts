import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from '../src/providers/anthropic.js';
import { GoogleAdapter } from '../src/providers/google.js';
import { OpenAIAdapter } from '../src/providers/openai.js';
import {
  ProviderError,
  type GenerationRequest,
  type ProviderAdapter,
  type ProviderStreamEvent,
} from '../src/providers/types.js';
import { streamWithRetry } from '../src/providers/service.js';

const request: GenerationRequest = {
  model: 'gpt-4.1',
  system: 'You are a test assistant.',
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.6,
  maxTokens: 256,
};

function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function collect(
  stream: AsyncGenerator<ProviderStreamEvent>
): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpenAIAdapter', () => {
  it('streams deltas, provider usage, and a finish reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}\n\n',
          'data: {"usage":{"prompt_tokens":12,"completion_tokens":4}}\n\n',
          'data: [DONE]\n\n',
        ])
      )
    );

    const events = await collect(new OpenAIAdapter('sk-test', 'https://api.openai.com').stream(request));

    expect(events.filter((event) => event.type === 'delta')).toEqual([
      { type: 'delta', text: 'Hi' },
      { type: 'delta', text: ' there' },
    ]);
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 12,
      outputTokens: 4,
      estimated: false,
    });
    expect(events).toContainEqual({ type: 'done', finishReason: 'stop' });
  });

  it('marks usage estimated when the provider does not report tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          'data: [DONE]\n\n',
        ])
      )
    );

    const events = await collect(new OpenAIAdapter('sk-test', 'https://api.openai.com').stream(request));
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 0,
      outputTokens: 0,
      estimated: true,
    });
  });

  it('rejects an invalid key without retrying', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { message: 'Invalid API key', code: 'invalid_api_key' } }, 401)
      )
    );

    await expect(
      collect(new OpenAIAdapter('sk-bad', 'https://api.openai.com').stream(request))
    ).rejects.toMatchObject({
      name: 'ProviderError',
      provider: 'openai',
      status: 401,
      retryable: false,
    });
  });

  it('maps rate limits to a retryable provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'Slow down' } }, 429))
    );

    await expect(
      collect(new OpenAIAdapter('sk-test', 'https://api.openai.com').stream(request))
    ).rejects.toMatchObject({
      status: 429,
      retryable: true,
      message: expect.stringContaining('rate limit'),
    });
  });

  it('maps network failures to a retryable NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      })
    );

    await expect(
      collect(new OpenAIAdapter('sk-test', 'https://api.openai.com').stream(request))
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });

  it('rejects an empty stream body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 }))
    );

    await expect(
      collect(new OpenAIAdapter('sk-test', 'https://api.openai.com').stream(request))
    ).rejects.toMatchObject({ code: 'EMPTY_STREAM' });
  });

  it('ignores malformed event payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['data: not-json\n\n', 'data: [DONE]\n\n']))
    );

    const events = await collect(new OpenAIAdapter('sk-test', 'https://api.openai.com').stream(request));
    expect(events.filter((event) => event.type === 'delta')).toEqual([]);
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 0,
      outputTokens: 0,
      estimated: true,
    });
  });

  it('validates keys against the models endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [] }, 200))
    );
    await expect(new OpenAIAdapter('sk-test', 'https://api.openai.com').validateKey()).resolves.toEqual({
      ok: true,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'bad' } }, 401))
    );
    await expect(
      new OpenAIAdapter('sk-bad', 'https://api.openai.com').validateKey()
    ).resolves.toMatchObject({ ok: false });
  });
});

describe('AnthropicAdapter', () => {
  it('streams deltas and usage from message_start/message_delta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: message_start\n',
          'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
          'event: content_block_delta\n',
          'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
          'event: message_delta\n',
          'data: {"type":"message_delta","usage":{"output_tokens":6},"delta":{"stop_reason":"end_turn"}}\n\n',
          'event: message_stop\n',
          'data: {"type":"message_stop"}\n\n',
        ])
      )
    );

    const events = await collect(
      new AnthropicAdapter('sk-ant-test', 'https://api.anthropic.com').stream({
        ...request,
        model: 'claude-sonnet-4-5',
      })
    );

    expect(events).toContainEqual({ type: 'delta', text: 'Hello' });
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 6,
      estimated: false,
    });
    expect(events).toContainEqual({ type: 'done', finishReason: 'end_turn' });
  });

  it('surfaces in-stream provider errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: error\n',
          'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
        ])
      )
    );

    await expect(
      collect(new AnthropicAdapter('sk-ant-test', 'https://api.anthropic.com').stream(request))
    ).rejects.toMatchObject({
      code: 'overloaded_error',
      retryable: true,
    });
  });

  it('maps 429 responses to retryable errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'rate limited' } }, 429))
    );

    await expect(
      collect(new AnthropicAdapter('sk-ant-test', 'https://api.anthropic.com').stream(request))
    ).rejects.toMatchObject({ status: 429, retryable: true });
  });
});

describe('GoogleAdapter', () => {
  it('streams candidate parts and usage metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Hi"},{"thought":true,"text":"hidden"}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":" there"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":2}}\n\n',
        ])
      )
    );

    const events = await collect(
      new GoogleAdapter('goog-test', 'https://generativelanguage.googleapis.com').stream({
        ...request,
        model: 'gemini-2.5-flash',
      })
    );

    expect(events.filter((event) => event.type === 'delta')).toEqual([
      { type: 'delta', text: 'Hi' },
      { type: 'delta', text: ' there' },
    ]);
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 7,
      outputTokens: 2,
      estimated: false,
    });
    expect(events).toContainEqual({ type: 'done', finishReason: 'STOP' });
  });

  it('surfaces payload errors and rejects invalid keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"error":{"code":403,"status":"PERMISSION_DENIED","message":"API key not valid"}}\n\n',
        ])
      )
    );

    await expect(
      collect(new GoogleAdapter('bad', 'https://generativelanguage.googleapis.com').stream(request))
    ).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'API key not valid' } }, 400))
    );
    await expect(
      new GoogleAdapter('bad', 'https://generativelanguage.googleapis.com').validateKey()
    ).resolves.toMatchObject({ ok: false });
  });
});

class ScriptedAdapter implements ProviderAdapter {
  readonly provider = 'openai' as const;
  attempts = 0;

  constructor(
    private readonly run: (attempt: number) => AsyncGenerator<ProviderStreamEvent>
  ) {}

  async *stream(): AsyncGenerator<ProviderStreamEvent> {
    this.attempts += 1;
    yield* this.run(this.attempts);
  }

  async validateKey() {
    return { ok: true };
  }
}

describe('streamWithRetry', () => {
  it('retries a retryable failure before any output is emitted', async () => {
    const adapter = new ScriptedAdapter(async function* (attempt) {
      if (attempt === 1) {
        throw new ProviderError('openai', 429, 'RATE_LIMITED', 'Try again', true);
      }
      yield { type: 'delta', text: 'Recovered' };
      yield { type: 'done', finishReason: 'stop' };
    });

    const events = await collect(streamWithRetry(adapter, request, { maxRetries: 1 }));
    expect(adapter.attempts).toBe(2);
    expect(events).toContainEqual({ type: 'delta', text: 'Recovered' });
  });

  it('does not retry after text has already been emitted', async () => {
    const adapter = new ScriptedAdapter(async function* () {
      yield { type: 'delta', text: 'Partial' };
      throw new ProviderError('openai', 503, 'UNAVAILABLE', 'Down mid-stream', true);
    });

    await expect(
      collect(streamWithRetry(adapter, request, { maxRetries: 2 }))
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(adapter.attempts).toBe(1);
  });

  it('normalizes a provider timeout', async () => {
    const adapter = new ScriptedAdapter(async function* () {
      throw new DOMException('timed out', 'TimeoutError');
    });

    await expect(
      collect(streamWithRetry(adapter, request, { maxRetries: 0 }))
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true });
  });
});
