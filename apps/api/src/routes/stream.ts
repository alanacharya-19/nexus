import type { FastifyPluginAsync } from 'fastify';
import type { RunEvent, StreamMessage } from '@nexus/shared';
import {
  authenticateToken,
  extractBearer,
  verifyStreamToken,
} from '../auth/auth.js';
import { Errors } from '../errors.js';
import { getRun, listEvents } from '../repositories/runs.js';
import { engine } from '../orchestration/engine.js';
import { eventBus } from '../orchestration/events.js';

export const streamRoutes: FastifyPluginAsync = async (app) => {
  app.get('/runs/:id/stream', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { token?: string; lastEventId?: string };
    const bearer = extractBearer(request.headers.authorization);
    const token = query.token ?? bearer;
    if (!token) throw Errors.unauthorized();

    let userId: string;
    if (query.token) {
      ({ userId } = await verifyStreamToken(query.token, id));
    } else {
      const auth = await authenticateToken(token);
      userId = auth.user.id;
    }

    const run = await getRun(userId, id);
    if (!run) throw Errors.notFound('Run');

    const headerLast = Number(request.headers['last-event-id'] ?? 0);
    const requestedLast = Number(query.lastEventId ?? headerLast ?? 0);
    let lastSeq =
      Number.isFinite(requestedLast) && requestedLast > 0 ? requestedLast : 0;

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

    const send = (message: StreamMessage) => {
      if (raw.writableEnded || raw.destroyed) return;
      raw.write(`event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`);
    };

    const sendRunEvent = (event: RunEvent) => {
      if (raw.writableEnded || raw.destroyed) return;
      if (event.seq > 0) {
        raw.write(
          `id: ${event.seq}\nevent: run.event\ndata: ${JSON.stringify(event)}\n\n`
        );
      } else {
        raw.write(`event: run.event\ndata: ${JSON.stringify(event)}\n\n`);
      }
    };

    send({
      event: 'stream.ready',
      data: { runId: id, lastSeq, live: engine.getLive(id) },
    });

    let replaying = true;
    const buffered: RunEvent[] = [];
    const unsubscribe = eventBus.subscribe(id, (event) => {
      if (event.seq > 0 && event.seq <= lastSeq) return;
      if (replaying) {
        buffered.push(event);
        return;
      }
      if (event.seq > 0) lastSeq = event.seq;
      sendRunEvent(event);
    });

    try {
      const events = await listEvents(id, lastSeq, 1_000);
      for (const event of events) {
        if (event.seq > lastSeq) lastSeq = event.seq;
        sendRunEvent(event);
      }
      replaying = false;
      buffered.sort((a, b) => a.seq - b.seq);
      for (const event of buffered) {
        if (event.seq > 0 && event.seq <= lastSeq) continue;
        if (event.seq > 0) lastSeq = event.seq;
        sendRunEvent(event);
      }
    } catch {
      replaying = false;
      send({
        event: 'stream.error',
        data: {
          code: 'REPLAY_FAILED',
          message: 'Could not replay earlier events. Refresh the run to resync.',
        },
      });
    }

    const heartbeat = setInterval(() => {
      send({ event: 'stream.heartbeat', data: { at: new Date().toISOString() } });
    }, 15_000);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
    };

    request.raw.on('close', cleanup);
    raw.on('close', cleanup);
    raw.on('error', cleanup);
  });
};
