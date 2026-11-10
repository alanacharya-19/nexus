import type { FastifyPluginAsync } from 'fastify';
import { createProjectSchema, updateProjectSchema } from '@nexus/shared';
import { requireAuth } from '../auth/middleware.js';
import { Errors } from '../errors.js';
import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
} from '../repositories/projects.js';

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.get('/projects', { preHandler: requireAuth }, async (request) => {
    const projects = await listProjects(request.authUser.id);
    return { projects };
  });

  app.post('/projects', { preHandler: requireAuth }, async (request, reply) => {
    const input = createProjectSchema.parse(request.body ?? {});
    const project = await createProject(request.authUser.id, input);
    return reply.status(201).send({ project });
  });

  app.patch('/projects/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const input = updateProjectSchema.parse(request.body ?? {});
    const project = await updateProject(request.authUser.id, id, input);
    if (!project) throw Errors.notFound('Project');
    return { project };
  });

  app.delete('/projects/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteProject(request.authUser.id, id);
    if (!deleted) throw Errors.notFound('Project');
    return { deleted: true };
  });
};
