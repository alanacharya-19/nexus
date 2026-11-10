import type { FastifyPluginAsync } from 'fastify';
import { usageQuerySchema } from '@nexus/shared';
import { requireAuth } from '../auth/middleware.js';
import {
  getUsageSummary,
  listUsageRecords,
} from '../repositories/usage.js';

export const usageRoutes: FastifyPluginAsync = async (app) => {
  app.get('/usage/summary', { preHandler: requireAuth }, async (request) => {
    const query = usageQuerySchema.parse(request.query ?? {});
    const summary = await getUsageSummary(request.authUser.id, query.days);
    return { summary };
  });

  app.get('/usage/records', { preHandler: requireAuth }, async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 100), 1), 500);
    const records = await listUsageRecords(request.authUser.id, limit);
    return { records };
  });
};
