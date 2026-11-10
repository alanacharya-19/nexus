import type {
  Agent,
  RunAgent,
  RunDetail,
  ProviderId,
  RunEventPayloads,
  RunEventType,
} from '@nexus/shared';
import { getModel } from '@nexus/shared';
import { Errors } from '../errors.js';
import { listAgents } from '../repositories/agents.js';
import { listArtifactsForRun } from '../repositories/artifacts.js';
import {
  appendEvent,
  getRun,
  listEvents,
  listInstructions,
} from '../repositories/runs.js';
import { engine } from '../orchestration/engine.js';
import { eventBus } from '../orchestration/events.js';

const REQUIRED_ROLES = ['planner', 'worker', 'reviewer', 'polisher'] as const;

function assertModel(provider: ProviderId, model: string) {
  const info = getModel(model);
  if (!info) {
    throw Errors.validation(`Unknown model "${model}". Choose a model from the catalog.`);
  }
  if (info.provider !== provider) {
    throw Errors.validation(
      `Model "${model}" belongs to ${info.provider}, not ${provider}.`
    );
  }
}

function toRunAgent(agent: Agent, overrides?: { provider?: ProviderId; model?: string }): RunAgent {
  const provider = overrides?.provider ?? agent.provider;
  const model = overrides?.model ?? agent.model;
  assertModel(provider, model);
  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    provider,
    model,
    systemPrompt: agent.systemPrompt,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    accent: agent.accent,
  };
}

export async function resolveRunAgents(
  userId: string,
  overrides?: { agentId: string; provider?: ProviderId; model?: string }[]
): Promise<RunAgent[]> {
  const agents = await listAgents(userId);
  const enabled = agents.filter((agent) => agent.enabled);

  let selected: Agent[];
  if (overrides && overrides.length > 0) {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const seen = new Set<string>();
    selected = [];
    for (const override of overrides) {
      if (seen.has(override.agentId)) continue;
      seen.add(override.agentId);
      const agent = byId.get(override.agentId);
      if (!agent) throw Errors.validation(`Agent ${override.agentId} was not found`);
      if (!agent.enabled) {
        throw Errors.validation(`Agent "${agent.name}" is disabled`);
      }
      selected.push(agent);
    }
  } else {
    selected = enabled;
  }

  if (selected.length === 0) {
    throw Errors.validation(
      'No enabled agents are available. Enable at least one agent in the Agents tab.'
    );
  }

  const roles = new Set(selected.map((agent) => agent.role));
  const missing = REQUIRED_ROLES.filter((role) => !roles.has(role));
  if (missing.length > 0) {
    throw Errors.validation(
      `This run is missing required agents: ${missing.join(', ')}. Include one agent per core role.`
    );
  }

  const overrideById = new Map((overrides ?? []).map((override) => [override.agentId, override]));
  return selected.map((agent) =>
    toRunAgent(agent, overrideById.get(agent.id))
  );
}

export async function getOwnedRun(userId: string, runId: string) {
  const run = await getRun(userId, runId);
  if (!run) throw Errors.notFound('Run');
  return run;
}

export async function buildRunDetail(userId: string, runId: string): Promise<RunDetail> {
  const run = await getOwnedRun(userId, runId);
  const [events, artifacts, instructions] = await Promise.all([
    listEvents(runId, 0, 500),
    listArtifactsForRun(runId),
    listInstructions(runId),
  ]);
  const live = engine.getLive(runId);
  return {
    run: { ...run, isLive: Boolean(live) || engine.isActive(runId) },
    events,
    artifacts,
    instructions,
    live,
  };
}

export async function emitRunEvent<K extends RunEventType>(
  runId: string,
  type: K,
  payload: RunEventPayloads[K],
  agentId: string | null = null
) {
  const event = await appendEvent(runId, type, payload, agentId);
  eventBus.publish(event);
  return event;
}
