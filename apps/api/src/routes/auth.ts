import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { AuthSession, ServerCapabilities } from '@nexus/shared';
import { PROVIDERS, devAuthSchema } from '@nexus/shared';
import { bootstrapUser, signLocalToken } from '../auth/auth.js';
import { requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { Errors } from '../errors.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/capabilities', async () => {
    const capabilities: ServerCapabilities = {
      name: 'NEXUS',
      version: config.version,
      authModes: [
        ...(config.supabaseUrl ? (['supabase'] as const) : []),
        ...(config.allowDevAuth ? (['local'] as const) : []),
      ],
      providers: PROVIDERS.map((provider) => ({
        provider,
        serverKey: Boolean(config.providerKeys[provider]),
      })),
      limits: {
        maxConcurrentRuns: config.maxConcurrentRuns,
        maxObjectiveLength: 20_000,
      },
    };
    return capabilities;
  });

  app.post(
    '/auth/dev',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!config.allowDevAuth) {
        throw Errors.notFound('Endpoint');
      }
      const input = devAuthSchema.parse(request.body ?? {});
      if (
        config.devAuthAllowlist.length > 0 &&
        !config.devAuthAllowlist.includes(input.email)
      ) {
        throw Errors.forbidden(
          'This email is not on the local workspace allowlist. Ask the operator to add it.'
        );
      }

      const user = await bootstrapUser({
        sub: randomUUID(),
        email: input.email,
        name: input.name ?? null,
      });
      const accessToken = await signLocalToken(user);
      const session: AuthSession = {
        accessToken,
        refreshToken: null,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1_000,
        user,
        mode: 'local',
      };
      return reply.status(200).send(session);
    }
  );

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    return { user: request.authUser, mode: request.authKind };
  });
};
