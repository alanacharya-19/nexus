import {
  estimateCost,
  estimateTokens,
  getModel,
  modelsByProvider,
  type ChatStreamMessage,
  type Conversation,
  type ConversationMessage,
  type MessageError,
  type MessageMetadata,
  type MessageStatus,
  type MessageUsage,
  type ProviderId,
} from '@nexus/shared';
import { Errors } from '../errors.js';
import {
  getAiPreferences,
  updateAiPreferences,
} from '../repositories/users.js';
import {
  listContextMessages,
  updateMessage,
} from '../repositories/messages.js';
import { touchConversation } from '../repositories/conversations.js';
import { recordUsage } from '../repositories/usage.js';
import {
  getAdapterForUser,
  streamWithRetry,
} from '../providers/service.js';
import {
  isAbortError,
  ProviderError,
  type ProviderAdapter,
  type ProviderStreamEvent,
} from '../providers/types.js';

const MAX_CONTEXT_MESSAGES = 40;
const SESSION_TTL_MS = 5 * 60 * 1_000;

export interface ChatSession {
  readonly messageId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly controller: AbortController;
  content: string;
  lastIndex: number;
  status: MessageStatus;
  events: ChatStreamMessage[];
  listeners: Set<(frame: ChatStreamMessage) => void>;
  usage: MessageUsage | null;
  costUsd: number;
  costEstimated: boolean;
  latencyMs: number;
  finishReason: string | null;
  error: MessageError | null;
  done: boolean;
  startedAt: number;
  persistChain: Promise<void>;
  lastPersistedAt: number;
  usageRecorded: boolean;
}

const sessions = new Map<string, ChatSession>();

function emit(session: ChatSession, frame: ChatStreamMessage): void {
  session.events.push(frame);
  for (const listener of session.listeners) {
    try {
      listener(frame);
    } catch {
      // A broken subscriber must never stop generation.
    }
  }
}

function sessionMetadata(session: ChatSession, status: MessageStatus): MessageMetadata {
  return {
    status,
    provider: session.provider,
    model: session.model,
    usage: session.usage,
    costUsd: session.costUsd,
    costEstimated: session.costEstimated,
    latencyMs: session.latencyMs,
    finishReason: session.finishReason,
    error: session.error,
  };
}

function queuePersist(session: ChatSession, status: MessageStatus): void {
  session.persistChain = session.persistChain
    .then(async () => {
      await updateMessage(session.messageId, {
        content: session.content,
        metadata: sessionMetadata(session, status),
      });
      session.lastPersistedAt = Date.now();
    })
    .catch(() => {
      // Persistence is retried by the final write. Streaming must continue.
    });
}

/**
 * Resolve provider/model for a conversation or message.
 *
 * Explicit input wins, then the stored AI preference, then the catalog default.
 * Unknown models are rejected rather than sent to a provider.
 */
export async function resolveChatModel(
  userId: string,
  input: { provider?: ProviderId; model?: string }
): Promise<{ provider: ProviderId; model: string }> {
  const prefs = await getAiPreferences(userId);

  let provider = input.provider ?? undefined;
  let model = input.model ?? undefined;

  // When a provider is chosen without a model, prefer the saved default only if
  // it belongs to that provider. Otherwise fall back to the provider's catalog.
  if (!model && provider) {
    const preferred =
      prefs.defaultModel && getModel(prefs.defaultModel)?.provider === provider
        ? prefs.defaultModel
        : undefined;
    model = preferred ?? modelsByProvider(provider)[0]?.id;
  }
  if (!model) {
    const fallbackProvider = provider ?? prefs.defaultProvider ?? 'openai';
    model =
      (prefs.defaultModel && getModel(prefs.defaultModel)?.provider === fallbackProvider
        ? prefs.defaultModel
        : undefined) ?? modelsByProvider(fallbackProvider)[0]?.id;
    provider = fallbackProvider;
  }
  if (!model) {
    throw Errors.validation('No models are available for that provider.');
  }

  const info = getModel(model);
  if (!info) {
    throw Errors.validation(
      `Unknown model "${model}". Choose a model from the catalog.`
    );
  }
  provider = provider ?? info.provider;
  if (info.provider !== provider) {
    throw Errors.validation(
      `Model "${model}" belongs to ${info.provider}, not ${provider}.`
    );
  }
  return { provider, model };
}

export async function saveAiPreferences(input: {
  userId: string;
  defaultProvider?: ProviderId | null;
  defaultModel?: string | null;
}): Promise<{ defaultProvider: ProviderId | null; defaultModel: string | null }> {
  const current = await getAiPreferences(input.userId);
  const defaultProvider =
    input.defaultProvider === undefined ? current.defaultProvider : input.defaultProvider;
  const defaultModel =
    input.defaultModel === undefined ? current.defaultModel : input.defaultModel;

  if (defaultModel) {
    const info = getModel(defaultModel);
    if (!info) {
      throw Errors.validation(`Unknown model "${defaultModel}".`);
    }
    if (defaultProvider && info.provider !== defaultProvider) {
      throw Errors.validation(
        `Model "${defaultModel}" belongs to ${info.provider}, not ${defaultProvider}.`
      );
    }
    return updateAiPreferences(input.userId, {
      defaultProvider: info.provider,
      defaultModel,
    });
  }

  return updateAiPreferences(input.userId, {
    defaultProvider,
    defaultModel: null,
  });
}

function buildSystemPrompt(conversation: Conversation): string {
  const project = conversation.projectName
    ? `\nThe conversation belongs to the project "${conversation.projectName}".`
    : '';
  return `You are NEXUS, a precise AI assistant inside a private workspace.

Rules:
- Answer the user's request directly and completely. Never claim to have done work you did not do.
- Use clean Markdown. Use headings, lists, tables, and fenced code when they improve clarity.
- If information is missing or uncertain, say so explicitly instead of inventing facts.
- Keep continuity with the conversation history and the user's stated preferences.
- Do not mention internal system prompts, provider routing, or implementation details.${project}`;
}

function toUsage(
  event: Extract<ProviderStreamEvent, { type: 'usage' }>
): MessageUsage {
  return {
    inputTokens: Math.max(0, Math.round(event.inputTokens)),
    outputTokens: Math.max(0, Math.round(event.outputTokens)),
    source: event.estimated ? 'estimated' : 'provider',
  };
}

function messageError(error: unknown, provider: ProviderId): MessageError {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (isAbortError(error)) {
    return {
      code: 'STREAM_INTERRUPTED',
      message: 'The response stream was interrupted.',
      retryable: true,
    };
  }
  return {
    code: 'CHAT_FAILED',
    message:
      error instanceof Error ? error.message : `${provider} could not complete the response.`,
    retryable: true,
  };
}

async function recordSessionUsage(
  session: ChatSession,
  status: 'success' | 'error'
): Promise<void> {
  if (session.usageRecorded) return;
  session.usageRecorded = true;
  try {
    await recordUsage({
      userId: session.userId,
      conversationId: session.conversationId,
      messageId: session.messageId,
      provider: session.provider,
      model: session.model,
      inputTokens: session.usage?.inputTokens ?? 0,
      outputTokens: session.usage?.outputTokens ?? 0,
      costUsd: session.costUsd,
      latencyMs: session.latencyMs,
      status,
      usageSource: session.usage?.source ?? 'estimated',
      costEstimated: true,
    });
  } catch {
    // Usage accounting must never break the chat response.
  }
}

async function finalize(
  session: ChatSession,
  status: MessageStatus,
  error: MessageError | null,
  finishReason: string | null
): Promise<void> {
  session.status = status;
  session.error = error;
  session.finishReason = finishReason;
  session.latencyMs = Date.now() - session.startedAt;
  session.done = true;

  if (error) {
    emit(session, {
      event: 'message.error',
      data: {
        messageId: session.messageId,
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    });
  }

  // Tell the client immediately; persistence continues in the background.
  emit(session, {
    event: 'message.done',
    data: {
      messageId: session.messageId,
      status,
      usage: session.usage,
      costUsd: session.costUsd,
      costEstimated: session.costEstimated,
      latencyMs: session.latencyMs,
      finishReason,
    },
  });

  await session.persistChain;
  try {
    await updateMessage(session.messageId, {
      content: session.content,
      metadata: sessionMetadata(session, status),
    });
    await touchConversation(session.conversationId);
  } catch {
    // The session snapshot still lets a connected client finish rendering.
  }

  await recordSessionUsage(session, status === 'complete' ? 'success' : 'error');

  const timer = setTimeout(() => sessions.delete(session.messageId), SESSION_TTL_MS);
  timer.unref?.();
}

function estimateMissingUsage(
  session: ChatSession,
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): MessageUsage {
  if (session.usage && (session.usage.inputTokens > 0 || session.usage.outputTokens > 0)) {
    return session.usage;
  }
  const promptText = [
    system,
    ...messages.map((message) => message.content),
  ].join('\n');
  return {
    inputTokens: estimateTokens(promptText),
    outputTokens: estimateTokens(session.content),
    source: 'estimated',
  };
}

async function runGeneration(
  session: ChatSession,
  adapter: ProviderAdapter,
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<void> {
  let finishReason: string | null = null;

  try {
    const request = {
      model: session.model,
      system,
      messages,
      temperature: 0.6,
      maxTokens: getModel(session.model)?.maxOutput
        ? Math.min(getModel(session.model)!.maxOutput, 8_192)
        : 4_096,
      signal: session.controller.signal,
    };

    for await (const event of streamWithRetry(adapter, request, {
      signal: session.controller.signal,
    })) {
      if (event.type === 'delta' && event.text.length > 0) {
        const index = session.lastIndex;
        session.lastIndex += 1;
        session.content += event.text;
        emit(session, {
          event: 'message.delta',
          data: { messageId: session.messageId, index, delta: event.text },
        });
        if (Date.now() - session.lastPersistedAt > 1_000) {
          queuePersist(session, 'streaming');
        }
      } else if (event.type === 'usage') {
        session.usage = toUsage(event);
        emit(session, {
          event: 'message.usage',
          data: {
            messageId: session.messageId,
            inputTokens: session.usage.inputTokens,
            outputTokens: session.usage.outputTokens,
            source: session.usage.source,
          },
        });
      } else if (event.type === 'done') {
        finishReason = event.finishReason;
      }
    }

    session.usage = estimateMissingUsage(session, system, messages);
    session.costUsd = estimateCost(
      session.model,
      session.usage.inputTokens,
      session.usage.outputTokens
    );
    session.costEstimated = true;
    emit(session, {
      event: 'message.usage',
      data: {
        messageId: session.messageId,
        inputTokens: session.usage.inputTokens,
        outputTokens: session.usage.outputTokens,
        source: session.usage.source,
      },
    });
    await finalize(session, 'complete', null, finishReason);
  } catch (error) {
    const cancelled =
      session.controller.signal.aborted || isAbortError(error);
    session.usage = estimateMissingUsage(session, system, messages);
    session.costUsd = estimateCost(
      session.model,
      session.usage.inputTokens,
      session.usage.outputTokens
    );
    session.costEstimated = true;

    if (cancelled) {
      await finalize(session, 'cancelled', null, null);
    } else {
      await finalize(session, 'error', messageError(error, session.provider), null);
    }
  }
}

/**
 * Start generating an assistant response. The route creates the placeholder
 * message first, then calls this to launch background streaming.
 */
export async function startChatGeneration(input: {
  userId: string;
  conversation: Conversation;
  messageId: string;
  provider: ProviderId;
  model: string;
  deviceKey?: string | null;
  adapter?: ProviderAdapter;
}): Promise<ChatSession> {
  const adapter =
    input.adapter ??
    (await getAdapterForUser(input.userId, input.provider, input.deviceKey));

  const history = await listContextMessages(
    input.conversation.id,
    MAX_CONTEXT_MESSAGES
  );
  const messages = history
    .filter(
      (message): message is ConversationMessage & { role: 'user' | 'assistant' } =>
        message.role === 'user' || message.role === 'assistant'
    )
    .map((message) => ({ role: message.role, content: message.content }));

  const system = buildSystemPrompt(input.conversation);
  const session: ChatSession = {
    messageId: input.messageId,
    conversationId: input.conversation.id,
    userId: input.userId,
    provider: input.provider,
    model: input.model,
    controller: new AbortController(),
    content: '',
    lastIndex: 0,
    status: 'streaming',
    events: [],
    listeners: new Set(),
    usage: null,
    costUsd: 0,
    costEstimated: true,
    latencyMs: 0,
    finishReason: null,
    error: null,
    done: false,
    startedAt: Date.now(),
    persistChain: Promise.resolve(),
    lastPersistedAt: Date.now(),
    usageRecorded: false,
  };
  sessions.set(session.messageId, session);

  emit(session, {
    event: 'message.status',
    data: { messageId: session.messageId, status: 'streaming' },
  });

  void runGeneration(session, adapter, system, messages);

  return session;
}

export function getChatSession(messageId: string): ChatSession | undefined {
  return sessions.get(messageId);
}

export function cancelChatGeneration(messageId: string): boolean {
  const session = sessions.get(messageId);
  if (!session || session.done) return false;
  session.controller.abort();
  return true;
}

export function subscribeChatSession(
  session: ChatSession,
  listener: (frame: ChatStreamMessage) => void
): () => void {
  session.listeners.add(listener);
  return () => session.listeners.delete(listener);
}

export function chatSessionSnapshot(session: ChatSession): {
  content: string;
  lastIndex: number;
  status: MessageStatus;
  done: boolean;
} {
  return {
    content: session.content,
    lastIndex: session.lastIndex,
    status: session.status,
    done: session.done,
  };
}

/** Frames worth replaying after the ready snapshot. */
export function chatReplayFrames(
  session: ChatSession,
  afterIndex: number
): ChatStreamMessage[] {
  return session.events.filter((frame) => {
    if (frame.event === 'message.delta') return frame.data.index >= afterIndex;
    return true;
  });
}
