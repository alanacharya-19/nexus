import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/middleware.js';
import { Errors } from '../errors.js';
import {
  deleteArtifact,
  getArtifact,
  listRecentArtifacts,
} from '../repositories/artifacts.js';

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'nexus-artifact'
  );
}

function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => code)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const artifactRoutes: FastifyPluginAsync = async (app) => {
  app.get('/artifacts', { preHandler: requireAuth }, async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const artifacts = await listRecentArtifacts(request.authUser.id, limit);
    return { artifacts };
  });

  app.get('/artifacts/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const artifact = await getArtifact(request.authUser.id, id);
    if (!artifact) throw Errors.notFound('Artifact');
    return { artifact };
  });

  app.get('/artifacts/:id/export', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { format?: string };
    const format = query.format ?? 'md';
    if (!['md', 'txt', 'json'].includes(format)) {
      throw Errors.validation('format must be one of md, txt, json');
    }

    const artifact = await getArtifact(request.authUser.id, id);
    if (!artifact) throw Errors.notFound('Artifact');

    const extension = format === 'json' ? 'json' : format === 'txt' ? 'txt' : 'md';
    const body =
      format === 'json'
        ? JSON.stringify(artifact, null, 2)
        : format === 'txt'
          ? markdownToPlain(artifact.content)
          : artifact.content;

    const filename = `${slugify(artifact.name)}-v${artifact.version}.${extension}`;
    reply
      .header('content-type', format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'private, no-store');
    return reply.send(body);
  });

  app.delete('/artifacts/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteArtifact(request.authUser.id, id);
    if (!deleted) throw Errors.notFound('Artifact');
    return { deleted: true };
  });
};
