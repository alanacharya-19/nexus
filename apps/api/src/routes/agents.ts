import type { FastifyPluginAsync } from 'fastify';
import { createAgentSchema, getModel, updateAgentSchema } from '@nexus/shared';
import { requireAuth } from '../auth/middleware.js';
import { Errors } from '../errors.js';
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
} from '../repositories/agents.js';

export const agentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/agents', { preHandler: requireAuth }, async (request) => {
    const agents = await listAgents(request.authUser.id);
    return { agents };
  });

  app.post('/agents', { preHandler: requireAuth }, async (request, reply) => {
    const input = createAgentSchema.parse(request.body ?? {});
    const model = getModel(input.model);
    if (!model || model.provider !== input.provider) {
      throw Errors.validation('Choose a model that belongs to the selected provider.');
    }
    const agent = await createAgent(request.authUser.id, { ...input, isDefault: false });
    return reply.status(201).send({ agent });
  });

  app.patch('/agents/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const input = updateAgentSchema.parse(request.body ?? {});
    const existing = await getAgent(request.authUser.id, id);
    if (!existing) throw Errors.notFound('Agent');

    const provider = input.provider ?? existing.provider;
    const model = input.model ?? existing.model;
    const info = getModel(model);
    if (!info || info.provider !== provider) {
      throw Errors.validation('Choose a model that belongs to the selected provider.');
    }

    const agent = await updateAgent(request.authUser.id, id, input);
    if (!agent) throw Errors.notFound('Agent');
    return { agent };
  });

  app.delete('/agents/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const agent = await getAgent(request.authUser.id, id);
    if (!agent) throw Errors.notFound('Agent');
    if (agent.isDefault) {
      throw Errors.conflict(
        'Default agents can be disabled but not deleted. Create a custom agent instead.'
      );
    }
    await deleteAgent(request.authUser.id, id);
    return { deleted: true };
  });
};
