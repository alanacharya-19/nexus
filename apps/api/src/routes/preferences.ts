import type { FastifyPluginAsync } from 'fastify';
import { aiPreferencesSchema } from '@nexus/shared';
import { requireAuth } from '../auth/middleware.js';
import { getAiPreferences } from '../repositories/users.js';
import { saveAiPreferences } from '../services/chat.js';

export const preferenceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/preferences/ai', { preHandler: requireAuth }, async (request) => {
    const preferences = await getAiPreferences(request.authUser.id);
    return { preferences };
  });

  app.put('/preferences/ai', { preHandler: requireAuth }, async (request) => {
    const input = aiPreferencesSchema.parse(request.body ?? {});
    const preferences = await saveAiPreferences({
      userId: request.authUser.id,
      defaultProvider: input.defaultProvider,
      defaultModel: input.defaultModel,
    });
    return { preferences };
  });
};
