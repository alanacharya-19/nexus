import { describe, expect, it } from 'vitest';
import { parseSse } from '../src/providers/sse.js';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]) {
  const events = [];
  for await (const event of parseSse(streamFromChunks(chunks))) {
    events.push(event);
  }
  return events;
}

describe('parseSse', () => {
  it('parses named events and data payloads', async () => {
    const events = await collect([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"delta":{"text":"Hello"}}\n\n',
    ]);
    expect(events).toEqual([
      { event: 'message_start', data: '{"type":"message_start"}' },
      { event: 'content_block_delta', data: '{"delta":{"text":"Hello"}}' },
    ]);
  });

  it('reassembles events split across chunk boundaries', async () => {
    const events = await collect([
      'event: content_bl',
      'ock_delta\ndata: {"delta":',
      '{"text":"Hi"}}\n',
      '\n',
    ]);
    expect(events).toEqual([
      { event: 'content_block_delta', data: '{"delta":{"text":"Hi"}}' },
    ]);
  });

  it('handles CRLF line endings', async () => {
    const events = await collect([
      'event: done\r\ndata: [DONE]\r\n\r\n',
    ]);
    expect(events).toEqual([{ event: 'done', data: '[DONE]' }]);
  });

  it('joins multi-line data and ignores comments', async () => {
    const events = await collect([
      ': keep-alive\n',
      'event: note\ndata: line one\ndata: line two\n\n',
    ]);
    expect(events).toEqual([{ event: 'note', data: 'line one\nline two' }]);
  });

  it('defaults the event name to message', async () => {
    const events = await collect(['data: plain\n\n']);
    expect(events).toEqual([{ event: 'message', data: 'plain' }]);
  });

  it('flushes a trailing block without a final blank line', async () => {
    const events = await collect(['data: trailing']);
    expect(events).toEqual([{ event: 'message', data: 'trailing' }]);
  });

  it('ignores blocks with no data lines', async () => {
    const events = await collect(['event: ping\n\n', 'data: real\n\n']);
    expect(events).toEqual([{ event: 'message', data: 'real' }]);
  });
});
