import type { FastifyPluginAsync } from 'fastify';
import {
  approvalDecisionSchema,
  createRunSchema,
  instructionSchema,
  listRunsQuerySchema,
  retryRunSchema,
  titleFromObjective,
  updateRunSchema,
} from '@nexus/shared';
import { requireAuth } from '../auth/middleware.js';
import { signStreamToken } from '../auth/auth.js';
import { Errors } from '../errors.js';
import {
  createRun,
  deleteRun,
  listEvents,
  listRuns,
  patchRun,
} from '../repositories/runs.js';
import { getProject } from '../repositories/projects.js';
import { getTemplate } from '../repositories/templates.js';
import { engine } from '../orchestration/engine.js';
import {
  buildRunDetail,
  emitRunEvent,
  getOwnedRun,
  resolveRunAgents,
} from '../services/runs.js';

export const runRoutes: FastifyPluginAsync = async (app) => {
  app.post('/runs', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.authUser.id;
    const input = createRunSchema.parse(request.body ?? {});

    if (input.projectId) {
      const project = await getProject(userId, input.projectId);
      if (!project) throw Errors.validation('The selected project no longer exists.');
    }
    if (input.templateId) {
      const template = await getTemplate(userId, input.templateId);
      if (!template) throw Errors.validation('The selected template no longer exists.');
    }

    const agents = await resolveRunAgents(userId, input.agents);
    const run = await createRun({
      userId,
      title: input.title?.trim() || titleFromObjective(input.objective),
      objective: input.objective,
      projectId: input.projectId ?? null,
      templateId: input.templateId ?? null,
      approvalMode: input.approvalMode,
      agents,
      maxReviewRounds: input.maxReviewRounds,
      maxDurationMs: input.maxDurationMs,
      maxTotalTokens: input.maxTotalTokens,
      maxCostUsd: input.maxCostUsd,
    });

    await emitRunEvent(run.id, 'run.created', {
      title: run.title,
      stage: 'plan',
    });
    await engine.start(run.id);

    const detail = await getOwnedRun(userId, run.id);
    return reply.status(201).send({ run: detail });
  });

  app.get('/runs', { preHandler: requireAuth }, async (request) => {
    const query = listRunsQuerySchema.parse(request.query ?? {});
    const { items, nextCursor } = await listRuns(request.authUser.id, query);
    return {
      runs: items.map((run) => ({
        ...run,
        isLive: engine.isActive(run.id) || Boolean(engine.getLive(run.id)),
      })),
      nextCursor,
    };
  });

  app.get('/runs/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return buildRunDetail(request.authUser.id, id);
  });

  app.patch('/runs/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const input = updateRunSchema.parse(request.body ?? {});
    await getOwnedRun(request.authUser.id, id);

    if (input.projectId) {
      const project = await getProject(request.authUser.id, input.projectId);
      if (!project) throw Errors.validation('The selected project no longer exists.');
    }

    await patchRun(id, input);
    return { run: await getOwnedRun(request.authUser.id, id) };
  });

  app.delete('/runs/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedRun(request.authUser.id, id);
    if (engine.isActive(id)) {
      throw Errors.conflict('Pause or cancel the run before deleting it.');
    }
    await deleteRun(request.authUser.id, id);
    return { deleted: true };
  });

  app.post('/runs/:id/start', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedRun(request.authUser.id, id);
    await engine.start(id);
    return { run: await getOwnedRun(request.authUser.id, id) };
  });

  app.post('/runs/:id/pause', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedRun(request.authUser.id, id);
    await engine.pause(id);
    return { run: await getOwnedRun(request.authUser.id, id) };
  });

  app.post('/runs/:id/resume', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedRun(request.authUser.id, id);
    await engine.resume(id);
    return { run: await getOwnedRun(request.authUser.id, id) };
  });

  app.post('/runs/:id/cancel', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedRun(request.authUser.id, id);
    const body = (request.body ?? {}) as { reason?: string };
    const reason =
      typeof body.reason === 'string' ? body.reason.slice(0, 300) : null;
    await engine.cancel(id, reason);
    return { run: await getOwnedRun(request.authUser.id, id) };
  });

  app.post('/runs/:id/retry', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedRun(request.authUser.id, id);
    const input = retryRunSchema.parse(request.body ?? {});
    await engine.retry(id, input.restartStage);
    return { run: await getOwnedRun(request.authUser.id, id) };
  });

  app.post('/runs/:id/approve', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedRun(request.authUser.id, id);
    const input = approvalDecisionSchema.parse(request.body ?? {});
    await engine.approve(id, input.decision, input.note ?? null);
    return { run: await getOwnedRun(request.authUser.id, id) };
  });

  app.post('/runs/:id/instructions', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedRun(request.authUser.id, id);
    const input = instructionSchema.parse(request.body ?? {});
    const instruction = await engine.steer(id, input.content);
    return {
      instruction,
      run: await getOwnedRun(request.authUser.id, id),
    };
  });

  app.get('/runs/:id/events', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await getOwnedRun(request.authUser.id, id);
    const query = request.query as { afterSeq?: string; limit?: string };
    const afterSeq = Number(query.afterSeq ?? 0);
    const limit = Math.min(Math.max(Number(query.limit ?? 500), 1), 1_000);
    if (!Number.isFinite(afterSeq) || afterSeq < 0) {
      throw Errors.validation('afterSeq must be a non-negative number');
    }
    const events = await listEvents(id, afterSeq, limit);
    return { events };
  });

  app.post(
    '/runs/:id/stream-token',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = request.params as { id: string };
      await getOwnedRun(request.authUser.id, id);
      const token = await signStreamToken(request.authUser.id, id);
      return { token, expiresIn: 600 };
    }
  );
};
