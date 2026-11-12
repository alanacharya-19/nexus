import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ConversationMessage,
  MessageError,
  MessageMetadata,
  MessageUsage,
  ProviderId,
} from '@nexus/shared';
import { api, ApiError, conversationStreamUrl } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

interface SendInput {
  content: string;
  provider?: ProviderId;
  model?: string;
  deviceKey?: string | null;
}

interface StreamFrame {
  event: string;
  data: Record<string, unknown>;
}

const ACTIVE_STATUSES = new Set(['pending', 'streaming']);

function sortMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return [...messages].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
  });
}

function mergeMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[]
): ConversationMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const next of incoming) {
    const existing = byId.get(next.id);
    if (!existing) {
      byId.set(next.id, next);
      continue;
    }
    if (
      ACTIVE_STATUSES.has(String(existing.metadata.status)) &&
      !ACTIVE_STATUSES.has(String(next.metadata.status))
    ) {
      byId.set(next.id, next);
      continue;
    }
    byId.set(next.id, {
      ...next,
      content: existing.content || next.content,
      metadata: { ...next.metadata, ...existing.metadata },
    });
  }
  return sortMessages([...byId.values()]);
}

export function useChatStream(
  conversationId: string,
  initialMessages: ConversationMessage[]
) {
  const queryClient = useQueryClient();
  const [messageState, setMessageState] = useState<ConversationMessage[]>(initialMessages);
  const [status, setStatus] = useState<'idle' | 'sending' | 'streaming' | 'reconnecting'>(
    'idle'
  );
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep fetched history merged with locally streamed/optimistic messages. This
  // is derived during render so a refetch never requires a state-syncing effect.
  const messages = useMemo(
    () => mergeMessages(messageState, initialMessages),
    [messageState, initialMessages]
  );

  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const activeMessageRef = useRef<string | null>(null);
  const attachedRef = useRef<Set<string>>(new Set());
  const lastIndexRef = useRef(0);
  const doneRef = useRef(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);
  const errorMetaRef = useRef<MessageError | null>(null);
  const usageRef = useRef<MessageUsage | null>(null);
  const connectRef = useRef<(messageId: string, token?: string) => Promise<void>>(
    async () => {}
  );

  const updateAssistant = useCallback(
    (messageId: string, update: (message: ConversationMessage) => ConversationMessage) => {
      setMessageState((current) => {
        const base = mergeMessages(current, initialMessages);
        if (!base.some((message) => message.id === messageId)) return current;
        return base.map((message) =>
          message.id === messageId ? update(message) : message
        );
      });
    },
    [initialMessages]
  );

  const finish = useCallback(
    (messageId: string, data: Record<string, unknown>) => {
      doneRef.current = true;
      attemptRef.current = 0;
      setConnected(false);
      setStatus('idle');
      const finalStatus =
        typeof data.status === 'string' ? data.status : 'complete';
      const usage = (data.usage as MessageUsage | null | undefined) ?? usageRef.current ?? null;
      const errorMeta = errorMetaRef.current;

      updateAssistant(messageId, (message) => ({
        ...message,
        metadata: {
          ...message.metadata,
          status: finalStatus as MessageMetadata['status'],
          usage,
          costUsd:
            typeof data.costUsd === 'number' ? data.costUsd : message.metadata.costUsd,
          costEstimated:
            typeof data.costEstimated === 'boolean'
              ? data.costEstimated
              : message.metadata.costEstimated,
          latencyMs:
            typeof data.latencyMs === 'number'
              ? data.latencyMs
              : message.metadata.latencyMs,
          finishReason:
            typeof data.finishReason === 'string'
              ? data.finishReason
              : message.metadata.finishReason ?? null,
          error: errorMeta,
        },
      }));
      activeMessageRef.current = null;
      xhrRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
    [conversationId, queryClient, updateAssistant]
  );

  const handleFrame = useCallback(
    (frame: StreamFrame) => {
      const messageId =
        typeof frame.data.messageId === 'string' ? frame.data.messageId : null;
      if (!messageId) return;

      switch (frame.event) {
        case 'stream.ready': {
          lastIndexRef.current =
            typeof frame.data.lastIndex === 'number' ? frame.data.lastIndex : 0;
          const content = typeof frame.data.content === 'string' ? frame.data.content : '';
          const readyStatus =
            typeof frame.data.status === 'string' ? frame.data.status : 'streaming';
          updateAssistant(messageId, (message) => ({
            ...message,
            content,
            metadata: { ...message.metadata, status: readyStatus as MessageMetadata['status'] },
          }));
          break;
        }
        case 'message.delta': {
          const index = typeof frame.data.index === 'number' ? frame.data.index : -1;
          if (index < lastIndexRef.current) return;
          const delta = typeof frame.data.delta === 'string' ? frame.data.delta : '';
          lastIndexRef.current = index + 1;
          updateAssistant(messageId, (message) => ({
            ...message,
            content: message.content + delta,
            metadata: { ...message.metadata, status: 'streaming' },
          }));
          break;
        }
        case 'message.usage': {
          const source = frame.data.source === 'provider' ? 'provider' : 'estimated';
          const usage: MessageUsage = {
            inputTokens: Number(frame.data.inputTokens ?? 0),
            outputTokens: Number(frame.data.outputTokens ?? 0),
            source,
          };
          usageRef.current = usage;
          updateAssistant(messageId, (message) => ({
            ...message,
            metadata: { ...message.metadata, usage },
          }));
          break;
        }
        case 'message.status': {
          const nextStatus =
            typeof frame.data.status === 'string' ? frame.data.status : 'streaming';
          updateAssistant(messageId, (message) => ({
            ...message,
            metadata: {
              ...message.metadata,
              status: nextStatus as MessageMetadata['status'],
            },
          }));
          break;
        }
        case 'message.error': {
          const errorMeta: MessageError = {
            code:
              typeof frame.data.code === 'string' ? frame.data.code : 'CHAT_FAILED',
            message:
              typeof frame.data.message === 'string'
                ? frame.data.message
                : 'The provider could not finish the response.',
            retryable: Boolean(frame.data.retryable),
          };
          errorMetaRef.current = errorMeta;
          setError(errorMeta.message);
          updateAssistant(messageId, (message) => ({
            ...message,
            metadata: { ...message.metadata, error: errorMeta },
          }));
          break;
        }
        case 'message.done': {
          finish(messageId, frame.data);
          break;
        }
        default:
          break;
      }
    },
    [finish, updateAssistant]
  );

  const scheduleRetry = useCallback(
    (messageId: string) => {
      if (doneRef.current || cancelledRef.current) return;
      if (retryRef.current) clearTimeout(retryRef.current);
      attemptRef.current += 1;
      if (attemptRef.current > 5) {
        setStatus('idle');
        setConnected(false);
        setError('The stream could not be reconnected. Reopen the conversation to retry.');
        return;
      }
      setStatus('reconnecting');
      const wait = Math.min(8_000, 700 * 2 ** (attemptRef.current - 1));
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        void connectRef.current(messageId);
      }, wait);
    },
    []
  );

  const connect = useCallback(
    async (messageId: string, tokenOverride?: string) => {
      if (doneRef.current || cancelledRef.current) return;
      if (xhrRef.current) return;
      xhrRef.current = new XMLHttpRequest();
      activeMessageRef.current = messageId;

      let token = tokenOverride;
      if (!token) {
        try {
          const result = await api.conversationStreamToken(conversationId);
          token = result.token;
        } catch (caught) {
          setStatus('reconnecting');
          setError(
            caught instanceof ApiError
              ? caught.message
              : 'Could not reconnect to the response stream.'
          );
          xhrRef.current = null;
          scheduleRetry(messageId);
          return;
        }
      }

      const xhr = xhrRef.current;
      xhr.open(
        'GET',
        conversationStreamUrl(conversationId, messageId, token, lastIndexRef.current)
      );
      xhr.setRequestHeader('accept', 'text/event-stream');

      let cursor = 0;
      let buffer = '';

      const processBlock = (block: string) => {
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const rawLine of block.split(/\r?\n/)) {
          if (!rawLine || rawLine.startsWith(':')) continue;
          const separator = rawLine.indexOf(':');
          const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
          let value = separator === -1 ? '' : rawLine.slice(separator + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') eventName = value;
          if (field === 'data') dataLines.push(value);
        }
        if (dataLines.length === 0) return;
        if (eventName === 'stream.heartbeat') return;
        try {
          const data = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
          handleFrame({ event: eventName, data });
        } catch {
          // A malformed frame is ignored; the next snapshot will resync.
        }
      };

      xhr.onprogress = () => {
        const text = xhr.responseText;
        const next = text.slice(cursor);
        cursor = text.length;
        buffer += next;
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          processBlock(block);
          boundary = buffer.indexOf('\n\n');
        }
      };

      xhr.onerror = () => {
        setConnected(false);
        if (doneRef.current || cancelledRef.current) return;
        xhrRef.current = null;
        setError('The response connection dropped. Reconnecting…');
        scheduleRetry(messageId);
      };

      xhr.onload = () => {
        setConnected(false);
        if (doneRef.current || cancelledRef.current) return;
        xhrRef.current = null;
        if (xhr.status === 401 || xhr.status === 403) {
          setStatus('idle');
          setError('Your session expired. Sign in again to continue this conversation.');
          return;
        }
        if (xhr.status >= 400) {
          setError('The response stream could not be opened. Reconnecting…');
          scheduleRetry(messageId);
          return;
        }
        scheduleRetry(messageId);
      };

      xhr.onreadystatechange = () => {
        if (xhr.readyState >= 2 && xhr.status === 200) {
          setConnected(true);
          setStatus('streaming');
          setError(null);
          attemptRef.current = 0;
        }
      };

      xhr.send();
    },
    [conversationId, handleFrame, scheduleRetry]
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const send = useCallback(
    async (input: SendInput) => {
      setError(null);
      setStatus('sending');
      doneRef.current = false;
      cancelledRef.current = false;
      errorMetaRef.current = null;
      usageRef.current = null;
      lastIndexRef.current = 0;
      attemptRef.current = 0;
      try {
        const result = await api.sendMessage(conversationId, input);
        const user = result.userMessage;
        const assistant: ConversationMessage = {
          ...result.assistantMessage,
          metadata: { ...result.assistantMessage.metadata, status: 'streaming' },
        };
        attachedRef.current.add(assistant.id);
        setMessageState((current) => sortMessages([...current, user, assistant]));
        setStatus('streaming');
        await connect(assistant.id, result.streamToken);
      } catch (caught) {
        setStatus('idle');
        setError(caught instanceof Error ? caught.message : 'Could not send the message.');
        throw caught;
      }
    },
    [connect, conversationId]
  );

  const cancel = useCallback(async () => {
    const messageId = activeMessageRef.current;
    if (!messageId) return;
    cancelledRef.current = true;
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    try {
      await api.cancelMessage(conversationId, messageId);
      updateAssistant(messageId, (message) => ({
        ...message,
        metadata: { ...message.metadata, status: 'cancelled' },
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not cancel the response.');
    }
  }, [conversationId, updateAssistant]);

  // Resume an in-flight response after opening the conversation again.
  useEffect(() => {
    if (xhrRef.current || doneRef.current) return;
    const candidates = messages.filter(
      (message) =>
        message.role === 'assistant' &&
        ACTIVE_STATUSES.has(String(message.metadata.status)) &&
        !attachedRef.current.has(message.id)
    );
    const last = candidates[candidates.length - 1];
    if (!last) return;
    attachedRef.current.add(last.id);
    doneRef.current = false;
    cancelledRef.current = false;
    lastIndexRef.current = 0;
    attemptRef.current = 0;
    setStatus('reconnecting');
    void connect(last.id);
  }, [connect, messages]);

  useEffect(() => {
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      xhrRef.current?.abort();
      xhrRef.current = null;
    };
  }, []);

  const streaming = status === 'sending' || status === 'streaming' || status === 'reconnecting';

  return {
    messages,
    send,
    cancel,
    status,
    connected,
    error,
    streaming,
    clearError: () => setError(null),
  };
}
