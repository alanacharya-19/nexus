import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { registerErrorHandler } from './errors.js';
import { query } from './db/pool.js';
import { agentRoutes } from './routes/agents.js';
import { artifactRoutes } from './routes/artifacts.js';
import { authRoutes } from './routes/auth.js';
import { conversationRoutes } from './routes/conversations.js';
import { credentialRoutes } from './routes/credentials.js';
import { modelRoutes } from './routes/models.js';
import { preferenceRoutes } from './routes/preferences.js';
import { projectRoutes } from './routes/projects.js';
import { runRoutes } from './routes/runs.js';
import { streamRoutes } from './routes/stream.js';
import { templateRoutes } from './routes/templates.js';
import { usageRoutes } from './routes/usage.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-provider-key"]',
          'req.body.apiKey',
          'req.body.password',
          '*.apiKey',
          '*.encryptedKey',
          '*.systemPrompt',
        ],
        censor: '[redacted]',
      },
    },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'last-event-id',
      'x-provider-key',
    ],
    exposedHeaders: ['content-disposition'],
    maxAge: 86_400,
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: [],
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
      },
    }),
  });

  app.setErrorHandler(registerErrorHandler);
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: request.id,
      },
    });
  });

  app.get('/health', async (request, reply) => {
    try {
      await query('SELECT 1');
      return {
        status: 'ok',
        version: config.version,
        database: 'up',
        uptimeSeconds: Math.round(process.uptime()),
      };
    } catch {
      request.log.error('health check: database unavailable');
      return reply.status(503).send({
        status: 'degraded',
        version: config.version,
        database: 'down',
        uptimeSeconds: Math.round(process.uptime()),
      });
    }
  });

  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(modelRoutes);
      await v1.register(agentRoutes);
      await v1.register(projectRoutes);
      await v1.register(templateRoutes);
      await v1.register(runRoutes);
      await v1.register(conversationRoutes);
      await v1.register(preferenceRoutes);
      await v1.register(artifactRoutes);
      await v1.register(usageRoutes);
      await v1.register(credentialRoutes);
      await v1.register(streamRoutes);
    },
    { prefix: '/v1' }
  );

  return app;
}
