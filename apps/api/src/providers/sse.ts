import type { ProviderId } from '@nexus/shared';
import { ProviderError } from './types.js';

export interface SseEvent {
  event: string;
  data: string;
}

/** Parse a `text/event-stream` body into discrete events. */
export async function* parseSse(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseBlock(raw);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = parseBlock(buffer.replace(/\r\n/g, '\n'));
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(raw: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}

export async function assertOk(response: Response, provider: ProviderId): Promise<void> {
  if (response.ok) return;

  let message = `${response.status} ${response.statusText}`;
  let code = `HTTP_${response.status}`;
  try {
    const text = await response.text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as Record<string, any>;
        const detail =
          parsed.error?.message ?? parsed.error?.type ?? parsed.message ?? parsed.error;
        if (typeof detail === 'string') message = detail;
        if (typeof parsed.error?.code === 'string') code = parsed.error.code;
        if (typeof parsed.error?.type === 'string') code = parsed.error.type;
      } catch {
        message = text.slice(0, 400);
      }
    }
  } catch {
    // Ignore body read failures; the status is still useful.
  }

  if (response.status === 401 || response.status === 403) {
    message = 'The provider rejected this API key. Check the key and its permissions.';
  }
  if (response.status === 429) {
    message = 'The provider rate limit was reached. NEXUS will retry automatically.';
  }

  throw new ProviderError(provider, response.status, code, message);
}
