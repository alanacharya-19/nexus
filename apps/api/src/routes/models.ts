import type { FastifyPluginAsync } from 'fastify';
import { MODELS, PROVIDER_META } from '@nexus/shared';
import { requireAuth } from '../auth/middleware.js';

export const modelRoutes: FastifyPluginAsync = async (app) => {
  app.get('/models', { preHandler: requireAuth }, async () => ({
    models: MODELS,
    providers: PROVIDER_META,
  }));
};
