import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  modelsByProvider,
  type Conversation,
  type ConversationMessage,
  type ProviderId,
} from '@nexus/shared';

const mocks = vi.hoisted(() => ({
  getAiPreferences: vi.fn(),
  updateAiPreferences: vi.fn(),
  listContextMessages: vi.fn(),
  updateMessage: vi.fn(),
  touchConversation: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock('../src/repositories/users.js', () => ({
  getAiPreferences: mocks.getAiPreferences,
  updateAiPreferences: mocks.updateAiPreferences,
}));

vi.mock('../src/repositories/messages.js', () => ({
  listContextMessages: mocks.listContextMessages,
  updateMessage: mocks.updateMessage,
}));

vi.mock('../src/repositories/conversations.js', () => ({
  touchConversation: mocks.touchConversation,
}));

vi.mock('../src/repositories/usage.js', () => ({
  recordUsage: mocks.recordUsage,
}));

const {
  cancelChatGeneration,
  chatReplayFrames,
  chatSessionSnapshot,
  getChatSession,
  resolveChatModel,
  saveAiPreferences,
  startChatGeneration,
  subscribeChatSession,
} = await import('../src/services/chat.js');

const { ProviderError } = await import('../src/providers/types.js');
type ChatSession = Awaited<ReturnType<typeof startChatGeneration>>;
type ProviderStreamEvent = import('../src/providers/types.js').ProviderStreamEvent;
type ProviderAdapter = import('../src/providers/types.js').ProviderAdapter;

const userId = '11111111-1111-1111-1111-111111111111';
const conversationId = '22222222-2222-2222-2222-222222222222';
const messageId = '33333333-3333-3333-3333-333333333333';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: conversationId,
    userId,
    projectId: null,
    projectName: null,
    title: 'Test conversation',
    provider: 'openai',
    model: 'gpt-4.1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    lastMessage: null,
    ...overrides,
  };
}

function historyMessage(content: string, role: 'user' | 'assistant'): ConversationMessage {
  return {
    id: `${role}-${content}`,
    conversationId,
    userId,
    role,
    content,
    metadata: { status: 'complete' },
    createdAt: new Date().toISOString(),
  };
}

function adapterFrom(
  events: ProviderStreamEvent[],
  options: { provider?: ProviderId; after?: (signal?: AbortSignal) => Promise<void> } = {}
): ProviderAdapter {
  return {
    provider: options.provider ?? 'openai',
    async *stream(request): AsyncGenerator<ProviderStreamEvent> {
      for (const event of events) yield event;
      if (options.after) await options.after(request.signal);
    },
    async validateKey() {
      return { ok: true };
    },
  };
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function waitForDone(session: ChatSession): Promise<void> {
  return new Promise((resolve) => {
    if (session.done) {
      resolve();
      return;
    }
    const unsubscribe = subscribeChatSession(session, (frame) => {
      if (frame.event !== 'message.done') return;
      unsubscribe();
      resolve();
    });
    if (session.done) {
      unsubscribe();
      resolve();
    }
  });
}

function emittedEvents(session: ChatSession) {
  return session.events;
}

beforeEach(() => {
  mocks.getAiPreferences.mockReset();
  mocks.updateAiPreferences.mockReset();
  mocks.listContextMessages.mockReset();
  mocks.updateMessage.mockReset();
  mocks.touchConversation.mockReset();
  mocks.recordUsage.mockReset();

  mocks.getAiPreferences.mockResolvedValue({ defaultProvider: null, defaultModel: null });
  mocks.listContextMessages.mockResolvedValue([historyMessage('Hello', 'user')]);
  mocks.updateMessage.mockResolvedValue(null);
  mocks.touchConversation.mockResolvedValue(undefined);
  mocks.recordUsage.mockResolvedValue(generateUsageRow());
  mocks.updateAiPreferences.mockImplementation(
    (_userId: string, input: { defaultProvider: ProviderId | null; defaultModel: string | null }) =>
      Promise.resolve(input)
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

function generateUsageRow() {
  return {
    id: messageId,
    userId,
    provider: 'openai' as const,
    model: 'gpt-4.1',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    status: 'success' as const,
    createdAt: new Date().toISOString(),
  };
}

describe('resolveChatModel', () => {
  it('honours an explicit provider and model', async () => {
    await expect(
      resolveChatModel(userId, { provider: 'anthropic', model: 'claude-sonnet-4-5' })
    ).resolves.toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
  });

  it('uses the catalog default for an explicitly chosen provider', async () => {
    mocks.getAiPreferences.mockResolvedValue({
      defaultProvider: 'openai',
      defaultModel: 'gpt-4.1',
    });

    const result = await resolveChatModel(userId, { provider: 'google' });
    expect(result.provider).toBe('google');
    expect(result.model).toBe(modelsByProvider('google')[0]?.id);
  });

  it('falls back to the saved default model and provider', async () => {
    mocks.getAiPreferences.mockResolvedValue({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });

    await expect(resolveChatModel(userId, {})).resolves.toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
    });
  });

  it('uses the saved default provider catalog when no model is saved', async () => {
    mocks.getAiPreferences.mockResolvedValue({
      defaultProvider: 'google',
      defaultModel: null,
    });

    const result = await resolveChatModel(userId, {});
    expect(result.provider).toBe('google');
    expect(result.model).toBe(modelsByProvider('google')[0]?.id);
  });

  it('rejects a model that belongs to a different provider', async () => {
    await expect(
      resolveChatModel(userId, { provider: 'openai', model: 'claude-sonnet-4-5' })
    ).rejects.toThrow(/belongs to anthropic/i);
  });

  it('rejects an unknown model instead of forwarding it', async () => {
    await expect(
      resolveChatModel(userId, { model: 'totally-made-up-model' })
    ).rejects.toThrow(/unknown model/i);
  });
});

describe('saveAiPreferences', () => {
  it('infers the provider from the selected model', async () => {
    await saveAiPreferences({ userId, defaultModel: 'claude-sonnet-4-5' });

    expect(mocks.updateAiPreferences).toHaveBeenCalledWith(userId, {
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-5',
    });
  });

  it('rejects a model/provider mismatch', async () => {
    await expect(
      saveAiPreferences({
        userId,
        defaultProvider: 'openai',
        defaultModel: 'gemini-2.5-pro',
      })
    ).rejects.toThrow(/belongs to google/i);
    expect(mocks.updateAiPreferences).not.toHaveBeenCalled();
  });

  it('rejects unknown models', async () => {
    await expect(
      saveAiPreferences({ userId, defaultModel: 'does-not-exist' })
    ).rejects.toThrow(/unknown model/i);
  });
});

describe('startChatGeneration', () => {
  it('streams deltas and records provider-reported usage', async () => {
    const adapter = adapterFrom([
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world' },
      { type: 'usage', inputTokens: 12, outputTokens: 4, estimated: false },
      { type: 'done', finishReason: 'stop' },
    ]);

    const session = await startChatGeneration({
      userId,
      conversation: conversation(),
      messageId,
      provider: 'openai',
      model: 'gpt-4.1',
      adapter,
    });

    await waitForDone(session);

    expect(session.status).toBe('complete');
    expect(session.content).toBe('Hello world');
    expect(session.error).toBeNull();
    expect(session.finishReason).toBe('stop');
    expect(session.usage).toEqual({
      inputTokens: 12,
      outputTokens: 4,
      source: 'provider',
    });
    expect(session.costEstimated).toBe(true);

    const deltas = emittedEvents(session).filter(
      (frame) => frame.event === 'message.delta'
    );
    expect(deltas).toEqual([
      { event: 'message.delta', data: { messageId, index: 0, delta: 'Hello' } },
      { event: 'message.delta', data: { messageId, index: 1, delta: ' world' } },
    ]);

    const snapshot = chatSessionSnapshot(session);
    expect(snapshot).toMatchObject({
      content: 'Hello world',
      lastIndex: 2,
      status: 'complete',
      done: true,
    });
    expect(chatReplayFrames(session, 1)).toContainEqual({
      event: 'message.delta',
      data: { messageId, index: 1, delta: ' world' },
    });

    await vi.waitFor(() => expect(mocks.recordUsage).toHaveBeenCalledTimes(1));
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        conversationId,
        messageId,
        provider: 'openai',
        model: 'gpt-4.1',
        inputTokens: 12,
        outputTokens: 4,
        status: 'success',
        usageSource: 'provider',
        costEstimated: true,
      })
    );

    await vi.waitFor(() =>
      expect(mocks.updateMessage).toHaveBeenCalledWith(
        messageId,
        expect.objectContaining({
          content: 'Hello world',
          metadata: expect.objectContaining({ status: 'complete' }),
        })
      )
    );
    expect(mocks.touchConversation).toHaveBeenCalledWith(conversationId);
  });

  it('estimates usage when the provider does not report tokens', async () => {
    const adapter = adapterFrom([
      { type: 'delta', text: 'A short answer' },
      { type: 'done', finishReason: 'stop' },
    ]);

    const session = await startChatGeneration({
      userId,
      conversation: conversation(),
      messageId,
      provider: 'openai',
      model: 'gpt-4.1',
      adapter,
    });
    await waitForDone(session);

    expect(session.status).toBe('complete');
    expect(session.usage?.source).toBe('estimated');
    expect(session.usage?.inputTokens).toBeGreaterThan(0);
    expect(session.usage?.outputTokens).toBeGreaterThan(0);
    expect(session.costUsd).toBeGreaterThan(0);

    await vi.waitFor(() => expect(mocks.recordUsage).toHaveBeenCalledTimes(1));
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        usageSource: 'estimated',
        costEstimated: true,
      })
    );
  });

  it('records an error and keeps partial text when the provider fails', async () => {
    const adapter: ProviderAdapter = {
      provider: 'openai',
      async *stream() {
        yield { type: 'delta', text: 'Partial answer' };
        throw new ProviderError(
          'openai',
          401,
          'INVALID_API_KEY',
          'The provided API key is invalid.',
          false
        );
      },
      async validateKey() {
        return { ok: false };
      },
    };

    const session = await startChatGeneration({
      userId,
      conversation: conversation(),
      messageId,
      provider: 'openai',
      model: 'gpt-4.1',
      adapter,
    });
    await waitForDone(session);

    expect(session.status).toBe('error');
    expect(session.content).toBe('Partial answer');
    expect(session.error).toEqual({
      code: 'INVALID_API_KEY',
      message: 'The provided API key is invalid.',
      retryable: false,
    });
    expect(session.usage?.source).toBe('estimated');

    expect(emittedEvents(session)).toContainEqual({
      event: 'message.error',
      data: {
        messageId,
        code: 'INVALID_API_KEY',
        message: 'The provided API key is invalid.',
        retryable: false,
      },
    });

    await vi.waitFor(() => expect(mocks.recordUsage).toHaveBeenCalledTimes(1));
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', usageSource: 'estimated' })
    );
  });

  it('cancels an in-flight response and persists the cancelled status', async () => {
    const adapter = adapterFrom(
      [{ type: 'delta', text: 'Starting' }],
      {
        after: (signal) =>
          new Promise<void>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(abortError());
              return;
            }
            signal?.addEventListener('abort', () => reject(abortError()), {
              once: true,
            });
          }),
      }
    );

    const session = await startChatGeneration({
      userId,
      conversation: conversation(),
      messageId,
      provider: 'openai',
      model: 'gpt-4.1',
      adapter,
    });

    await vi.waitFor(() => expect(session.content).toBe('Starting'));
    expect(cancelChatGeneration(messageId)).toBe(true);
    await waitForDone(session);

    expect(session.status).toBe('cancelled');
    expect(session.error).toBeNull();
    expect(session.content).toBe('Starting');
    expect(session.usage?.source).toBe('estimated');
    expect(emittedEvents(session)).toContainEqual({
      event: 'message.done',
      data: expect.objectContaining({ status: 'cancelled' }),
    });

    await vi.waitFor(() => expect(mocks.recordUsage).toHaveBeenCalledTimes(1));
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' })
    );
    expect(cancelChatGeneration(messageId)).toBe(false);
  });

  it('exposes the live session for reconnects', async () => {
    const adapter = adapterFrom([{ type: 'done', finishReason: 'stop' }]);
    const session = await startChatGeneration({
      userId,
      conversation: conversation(),
      messageId,
      provider: 'openai',
      model: 'gpt-4.1',
      adapter,
    });

    expect(getChatSession(messageId)).toBe(session);
    await waitForDone(session);
  });
});
