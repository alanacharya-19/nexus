import type { ServerResponse } from 'node:http';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  createConversationSchema,
  listConversationsQuerySchema,
  sendMessageSchema,
  titleFromObjective,
  updateConversationSchema,
  type ChatStreamMessage,
  type ConversationMessage,
  type MessageMetadata,
} from '@nexus/shared';
import {
  authenticateToken,
  extractBearer,
  signConversationStreamToken,
  verifyConversationStreamToken,
} from '../auth/auth.js';
import { requireAuth } from '../auth/middleware.js';
import { Errors } from '../errors.js';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
} from '../repositories/conversations.js';
import {
  createMessage,
  getMessage,
  listMessages,
  updateMessage,
} from '../repositories/messages.js';
import { getProject } from '../repositories/projects.js';
import { getAdapterForUser } from '../providers/service.js';
import {
  cancelChatGeneration,
  chatSessionSnapshot,
  getChatSession,
  resolveChatModel,
  startChatGeneration,
  subscribeChatSession,
} from '../services/chat.js';

function deviceKeyFrom(request: FastifyRequest): string | null {
  const raw = request.headers['x-provider-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 400) {
    throw Errors.validation('The device provider key header is invalid.');
  }
  return trimmed;
}

function sendFrame(raw: ServerResponse, frame: ChatStreamMessage): void {
  if (raw.writableEnded || raw.destroyed) return;
  raw.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
}

function doneFrameFromMessage(message: ConversationMessage): ChatStreamMessage {
  const meta = message.metadata;
  return {
    event: 'message.done',
    data: {
      messageId: message.id,
      status: meta.status,
      usage: meta.usage ?? null,
      costUsd: meta.costUsd ?? 0,
      costEstimated: meta.costEstimated ?? true,
      latencyMs: meta.latencyMs ?? 0,
      finishReason: meta.finishReason ?? null,
    },
  };
}

function replayFallback(raw: ServerResponse, message: ConversationMessage): void {
  const meta = message.metadata;
  const status = meta.status;
  sendFrame(raw, {
    event: 'stream.ready',
    data: {
      conversationId: message.conversationId,
      messageId: message.id,
      status,
      content: message.content,
      lastIndex: 0,
    },
  });

  if (status === 'streaming' || status === 'pending') {
    const error = {
      code: 'STREAM_UNAVAILABLE',
      message:
        'This response is no longer streaming. Send the message again to get a fresh answer.',
      retryable: true,
    };
    sendFrame(raw, {
      event: 'message.error',
      data: { messageId: message.id, ...error },
    });
    sendFrame(raw, {
      event: 'message.done',
      data: {
        messageId: message.id,
        status: 'error',
        usage: null,
        costUsd: 0,
        costEstimated: true,
        latencyMs: 0,
        finishReason: null,
      },
    });
    return;
  }

  if (status === 'error' && meta.error) {
    sendFrame(raw, {
      event: 'message.error',
      data: { messageId: message.id, ...meta.error },
    });
  }
  sendFrame(raw, doneFrameFromMessage(message));
}

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/conversations', { preHandler: requireAuth }, async (request) => {
    const query = listConversationsQuerySchema.parse(request.query ?? {});
    const result = await listConversations(request.authUser.id, query);
    return { conversations: result.items, nextCursor: result.nextCursor };
  });

  app.post('/conversations', { preHandler: requireAuth }, async (request, reply) => {
    const input = createConversationSchema.parse(request.body ?? {});
    if (input.projectId) {
      const project = await getProject(request.authUser.id, input.projectId);
      if (!project) throw Errors.validation('The selected project no longer exists.');
    }

    const choice = await resolveChatModel(request.authUser.id, {
      provider: input.provider,
      model: input.model,
    });
    const conversation = await createConversation({
      userId: request.authUser.id,
      title: input.title?.trim() || 'New conversation',
      projectId: input.projectId ?? null,
      provider: choice.provider,
      model: choice.model,
    });
    return reply.status(201).send({ conversation });
  });

  app.get('/conversations/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const conversation = await getConversation(request.authUser.id, id);
    if (!conversation) throw Errors.notFound('Conversation');
    const messages = await listMessages(request.authUser.id, id, { limit: 500 });
    return { conversation, messages };
  });

  app.patch('/conversations/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const input = updateConversationSchema.parse(request.body ?? {});
    const existing = await getConversation(request.authUser.id, id);
    if (!existing) throw Errors.notFound('Conversation');

    if (input.projectId) {
      const project = await getProject(request.authUser.id, input.projectId);
      if (!project) throw Errors.validation('The selected project no longer exists.');
    }

    let provider = input.provider;
    let model = input.model;
    if (provider !== undefined || model !== undefined) {
      const choice = await resolveChatModel(request.authUser.id, {
        provider: provider ?? existing.provider,
        model: model ?? existing.model,
      });
      provider = choice.provider;
      model = choice.model;
    }

    const conversation = await updateConversation(request.authUser.id, id, {
      title: input.title,
      projectId:
        input.projectId === undefined ? undefined : input.projectId,
      provider,
      model,
    });
    if (!conversation) throw Errors.notFound('Conversation');
    return { conversation };
  });

  app.delete('/conversations/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteConversation(request.authUser.id, id);
    if (!deleted) throw Errors.notFound('Conversation');
    return { deleted: true };
  });

  app.get('/conversations/:id/messages', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const conversation = await getConversation(request.authUser.id, id);
    if (!conversation) throw Errors.notFound('Conversation');
    const query = request.query as { limit?: string; after?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 500), 1), 1_000);
    const messages = await listMessages(request.authUser.id, id, {
      limit,
      after: query.after,
    });
    return { messages };
  });

  app.post('/conversations/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = sendMessageSchema.parse(request.body ?? {});
    const conversation = await getConversation(request.authUser.id, id);
    if (!conversation) throw Errors.notFound('Conversation');

    const choice = await resolveChatModel(request.authUser.id, {
      provider: input.provider ?? conversation.provider,
      model: input.model ?? conversation.model,
    });
    const deviceKey = deviceKeyFrom(request);
    // Resolve the adapter before writing messages so a missing or rejected key
    // surfaces as a clean 4xx/424 instead of an orphaned user message.
    const adapter = await getAdapterForUser(
      request.authUser.id,
      choice.provider,
      deviceKey
    );

    const firstMessage =
      (conversation.messageCount ?? 0) === 0 &&
      (conversation.title === 'New conversation' || conversation.title.trim() === '');

    if (choice.provider !== conversation.provider || choice.model !== conversation.model) {
      await updateConversation(request.authUser.id, id, {
        provider: choice.provider,
        model: choice.model,
      });
    }
    if (firstMessage) {
      await updateConversation(request.authUser.id, id, {
        title: titleFromObjective(input.content),
      });
    }

    const userMetadata: MessageMetadata = {
      status: 'complete',
      provider: choice.provider,
      model: choice.model,
    };
    const userMessage = await createMessage({
      conversationId: id,
      userId: request.authUser.id,
      role: 'user',
      content: input.content,
      metadata: userMetadata,
    });
    const assistantMessage = await createMessage({
      conversationId: id,
      userId: request.authUser.id,
      role: 'assistant',
      content: '',
      metadata: {
        status: 'pending',
        provider: choice.provider,
        model: choice.model,
      },
    });

    await startChatGeneration({
      userId: request.authUser.id,
      conversation,
      messageId: assistantMessage.id,
      provider: choice.provider,
      model: choice.model,
      deviceKey,
      adapter,
    });

    const token = await signConversationStreamToken(request.authUser.id, id);
    return reply.status(201).send({
      userMessage,
      assistantMessage: {
        ...assistantMessage,
        metadata: {
          ...assistantMessage.metadata,
          status: 'streaming',
        } satisfies MessageMetadata,
      },
      streamToken: token,
      expiresIn: 600,
    });
  });

  app.post(
    '/conversations/:id/stream-token',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      const conversation = await getConversation(request.authUser.id, id);
      if (!conversation) throw Errors.notFound('Conversation');
      const token = await signConversationStreamToken(request.authUser.id, id);
      return { token, expiresIn: 600 };
    }
  );

  app.post(
    '/conversations/:id/messages/:messageId/cancel',
    { preHandler: requireAuth },
    async (request) => {
      const { id, messageId } = request.params as {
        id: string;
        messageId: string;
      };
      const message = await getMessage(request.authUser.id, id, messageId);
      if (!message) throw Errors.notFound('Message');
      if (message.role !== 'assistant') {
        throw Errors.validation('Only assistant responses can be cancelled.');
      }

      const cancelled = cancelChatGeneration(messageId);
      if (!cancelled) {
        await updateMessage(messageId, {
          metadata: {
            ...message.metadata,
            status: 'cancelled',
          },
        });
      }
      return { cancelled: true };
    }
  );

  app.get('/conversations/:id/messages/:messageId/stream', async (request, reply) => {
    const { id, messageId } = request.params as {
      id: string;
      messageId: string;
    };
    const query = request.query as { token?: string; lastIndex?: string };
    const bearer = extractBearer(request.headers.authorization);
    const token = query.token ?? bearer;
    if (!token) throw Errors.unauthorized();

    let userId: string;
    if (query.token) {
      ({ userId } = await verifyConversationStreamToken(query.token, id));
    } else {
      const auth = await authenticateToken(token);
      userId = auth.user.id;
    }

    const conversation = await getConversation(userId, id);
    if (!conversation) throw Errors.notFound('Conversation');
    const message = await getMessage(userId, id, messageId);
    if (!message) throw Errors.notFound('Message');

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': request.headers.origin ?? '*',
    });
    raw.write(': connected\n\n');

    const session = getChatSession(messageId);
    if (!session) {
      replayFallback(raw, message);
      raw.end();
      return;
    }

    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let replaying = true;
    const buffered: ChatStreamMessage[] = [];

    function cleanup() {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    }

    const unsubscribe = subscribeChatSession(session, (frame) => {
      if (replaying) {
        buffered.push(frame);
        return;
      }
      sendFrame(raw, frame);
      if (frame.event === 'message.done') {
        cleanup();
        raw.end();
      }
    });
    const existing = session.events.slice();
    const snapshot = chatSessionSnapshot(session);

    sendFrame(raw, {
      event: 'stream.ready',
      data: {
        conversationId: id,
        messageId,
        status: snapshot.status,
        content: snapshot.content,
        lastIndex: snapshot.lastIndex,
      },
    });

    for (const frame of existing) {
      if (frame.event === 'message.delta') continue;
      sendFrame(raw, frame);
    }

    replaying = false;
    for (const frame of buffered) {
      if (frame.event === 'message.delta' && frame.data.index < snapshot.lastIndex) {
        continue;
      }
      sendFrame(raw, frame);
      if (frame.event === 'message.done') {
        cleanup();
        raw.end();
        return;
      }
    }

    if (snapshot.done) {
      cleanup();
      raw.end();
      return;
    }

    heartbeat = setInterval(() => {
      sendFrame(raw, {
        event: 'stream.heartbeat',
        data: { at: new Date().toISOString() },
      });
    }, 15_000);

    request.raw.on('close', cleanup);
    raw.on('close', cleanup);
    raw.on('error', cleanup);
  });
};
