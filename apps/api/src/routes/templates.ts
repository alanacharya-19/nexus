import type { FastifyPluginAsync } from 'fastify';
import { createTemplateSchema } from '@nexus/shared';
import { requireAuth } from '../auth/middleware.js';
import { Errors } from '../errors.js';
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
} from '../repositories/templates.js';

export const templateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/templates', { preHandler: requireAuth }, async (request) => {
    const templates = await listTemplates(request.authUser.id);
    return { templates };
  });

  app.post('/templates', { preHandler: requireAuth }, async (request, reply) => {
    const input = createTemplateSchema.parse(request.body ?? {});
    const template = await createTemplate(request.authUser.id, input);
    return reply.status(201).send({ template });
  });

  app.delete('/templates/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const template = await getTemplate(request.authUser.id, id);
    if (!template) throw Errors.notFound('Template');
    if (template.isBuiltin) {
      throw Errors.conflict('Built-in templates cannot be deleted. Duplicate it as a custom template instead.');
    }
    await deleteTemplate(request.authUser.id, id);
    return { deleted: true };
  });
};
