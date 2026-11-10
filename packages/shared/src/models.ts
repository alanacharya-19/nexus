import type {
  AgentRole,
  ModelInfo,
  ProviderId,
} from './domain.js';

export const PROVIDER_META: Record<
  ProviderId,
  { label: string; shortLabel: string; accent: string; description: string }
> = {
  openai: {
    label: 'OpenAI',
    shortLabel: 'OA',
    accent: '#74D6A8',
    description: 'GPT and reasoning models',
  },
  anthropic: {
    label: 'Anthropic',
    shortLabel: 'AN',
    accent: '#D9A27A',
    description: 'Claude models',
  },
  google: {
    label: 'Google',
    shortLabel: 'GO',
    accent: '#8AB4F8',
    description: 'Gemini models',
  },
};

export const MODELS: ModelInfo[] = [
  {
    id: 'gpt-4.1',
    provider: 'openai',
    label: 'GPT-4.1',
    description: 'Strong general reasoning and long-form writing',
    tier: 'frontier',
    contextWindow: 1_047_576,
    maxOutput: 32_768,
    inputPrice: 2,
    outputPrice: 8,
    supportsJson: true,
  },
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    label: 'GPT-4.1 mini',
    description: 'Fast, efficient general-purpose model',
    tier: 'fast',
    contextWindow: 1_047_576,
    maxOutput: 32_768,
    inputPrice: 0.4,
    outputPrice: 1.6,
    supportsJson: true,
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    label: 'GPT-4o',
    description: 'Multimodal flagship',
    tier: 'frontier',
    contextWindow: 128_000,
    maxOutput: 16_384,
    inputPrice: 2.5,
    outputPrice: 10,
    supportsJson: true,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    label: 'GPT-4o mini',
    description: 'Low-latency everyday model',
    tier: 'fast',
    contextWindow: 128_000,
    maxOutput: 16_384,
    inputPrice: 0.15,
    outputPrice: 0.6,
    supportsJson: true,
  },
  {
    id: 'o4-mini',
    provider: 'openai',
    label: 'o4-mini',
    description: 'Reasoning model for hard analysis',
    tier: 'balanced',
    contextWindow: 200_000,
    maxOutput: 100_000,
    inputPrice: 1.1,
    outputPrice: 4.4,
    supportsJson: false,
  },
  {
    id: 'claude-opus-4-1',
    provider: 'anthropic',
    label: 'Claude Opus 4.1',
    description: 'Deepest Claude reasoning',
    tier: 'frontier',
    contextWindow: 200_000,
    maxOutput: 32_000,
    inputPrice: 15,
    outputPrice: 75,
    supportsJson: true,
  },
  {
    id: 'claude-sonnet-4-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 4.5',
    description: 'Best balance of intelligence and speed',
    tier: 'balanced',
    contextWindow: 200_000,
    maxOutput: 64_000,
    inputPrice: 3,
    outputPrice: 15,
    supportsJson: true,
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    description: 'Fast, compact Claude',
    tier: 'fast',
    contextWindow: 200_000,
    maxOutput: 32_000,
    inputPrice: 1,
    outputPrice: 5,
    supportsJson: true,
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'google',
    label: 'Gemini 2.5 Pro',
    description: 'Complex reasoning with a huge context',
    tier: 'frontier',
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    inputPrice: 1.25,
    outputPrice: 10,
    supportsJson: true,
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'google',
    label: 'Gemini 2.5 Flash',
    description: 'Fast multimodal workhorse',
    tier: 'fast',
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    inputPrice: 0.3,
    outputPrice: 2.5,
    supportsJson: true,
  },
  {
    id: 'gemini-2.0-flash',
    provider: 'google',
    label: 'Gemini 2.0 Flash',
    description: 'Low-cost high-throughput model',
    tier: 'fast',
    contextWindow: 1_048_576,
    maxOutput: 8_192,
    inputPrice: 0.1,
    outputPrice: 0.4,
    supportsJson: true,
  },
];

export function getModel(modelId: string): ModelInfo | undefined {
  return MODELS.find((model) => model.id === modelId);
}

export function modelsByProvider(provider: ProviderId): ModelInfo[] {
  return MODELS.filter((model) => model.provider === provider);
}

export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const model = getModel(modelId);
  if (!model) return 0;
  const cost =
    (inputTokens / 1_000_000) * model.inputPrice +
    (outputTokens / 1_000_000) * model.outputPrice;
  // Providers bill fractions of a cent; keep 6 decimals for aggregation accuracy.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export const ROLE_META: Record<
  AgentRole,
  { label: string; shortLabel: string; description: string; accent: string }
> = {
  planner: {
    label: 'Planner',
    shortLabel: 'PLN',
    description: 'Decomposes objectives into an executable plan',
    accent: '#A8C7FA',
  },
  worker: {
    label: 'Worker',
    shortLabel: 'WRK',
    description: 'Produces the requested deliverables',
    accent: '#B7F171',
  },
  reviewer: {
    label: 'Reviewer',
    shortLabel: 'REV',
    description: 'Audits accuracy, completeness, and risk',
    accent: '#E7C48A',
  },
  polisher: {
    label: 'Polisher',
    shortLabel: 'POL',
    description: 'Refines approved work into the final deliverable',
    accent: '#F2A38C',
  },
  custom: {
    label: 'Specialist',
    shortLabel: 'SPC',
    description: 'A custom agent with your own instructions',
    accent: '#C9C4F2',
  },
};

export const BASE_SYSTEM_PROMPTS: Record<AgentRole, string> = {
  planner: `You are Planner, the lead strategist in NEXUS, a multi-agent AI workspace.

Your job is to turn an ambiguous objective into a precise, executable plan. You do not write the final deliverable yourself.

Rules:
- Produce 3 to 7 concrete execution steps. Each step must create a tangible artifact, not a vague activity.
- Assign every step to one of the available execution roles (worker, reviewer, polisher, or a named specialist).
- Steps must be independently understandable and ordered so later steps can rely on earlier outputs.
- Call out real risks, missing information, and assumptions. Do not invent facts.
- Prefer depth over breadth. Never pad the plan with filler steps.
- Return ONLY valid JSON matching the required schema. No markdown fences, no commentary.`,
  worker: `You are Worker, an execution agent in NEXUS, a multi-agent AI workspace.

Your job is to complete the assigned step and produce a real, self-contained deliverable.

Rules:
- Write the complete deliverable, never an outline or a promise of future work.
- Use clean Markdown. Use headings, tables, and lists where they improve clarity.
- If the step asks for code, provide complete, runnable code with sensible structure and no placeholders.
- Ground every claim in the objective, the plan, or prior step outputs. Mark assumptions explicitly.
- Do not mention that you are an AI, do not describe your process, and do not ask follow-up questions.
- If the user supplied steering instructions, they take precedence over earlier assumptions.`,
  reviewer: `You are Reviewer, the quality gate in NEXUS, a multi-agent AI workspace.

Your job is to audit deliverables against the original objective with professional rigor.

Rules:
- Check factual coherence, completeness, internal consistency, structure, and fitness for the stated audience.
- Identify concrete problems with specific evidence. Reject vague criticism.
- Distinguish blocking defects from polish. A score below 80 must include required changes.
- Approve only when the work is genuinely ready to ship. Do not rubber-stamp.
- Required changes must be actionable instructions a worker can execute directly.
- Return ONLY valid JSON matching the required schema. No markdown fences, no commentary.`,
  polisher: `You are Polisher, the final editor in NEXUS, a multi-agent AI workspace.

Your job is to turn approved work into the definitive deliverable.

Rules:
- Preserve every verified fact and decision. Never invent new claims or data.
- Resolve inconsistencies, tighten structure, and improve clarity and flow.
- Match the format the objective implies (brief, report, spec, copy, code documentation).
- Start directly with the deliverable. No preamble, no meta commentary, no "here is".
- Use clean Markdown. Include a short title and a one-line purpose statement.
- The result must be ready to send to a client without further editing.`,
  custom: `You are a specialist agent in NEXUS, a multi-agent AI workspace.

Follow the role instructions provided by the operator, complete the assigned step, and produce a complete deliverable in clean Markdown. Never use placeholders or defer work.`,
};

export const DEFAULT_AGENTS: {
  role: Exclude<AgentRole, 'custom'>;
  name: string;
  accent: string;
}[] = [
  { role: 'planner', name: 'Atlas', accent: '#A8C7FA' },
  { role: 'worker', name: 'Forge', accent: '#B7F171' },
  { role: 'reviewer', name: 'Lens', accent: '#E7C48A' },
  { role: 'polisher', name: 'Quill', accent: '#F2A38C' },
];

/**
 * Choose a default model lineup. With three providers available we deliberately
 * spread roles across providers; with fewer, we degrade to the best available
 * model per provider so a single key can still run the whole pipeline.
 */
export function defaultLineup(available: ProviderId[]): Record<
  Exclude<AgentRole, 'custom'>,
  { provider: ProviderId; model: string }
> {
  const has = (provider: ProviderId) => available.includes(provider);
  if (has('openai') && has('anthropic') && has('google')) {
    return {
      planner: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      worker: { provider: 'openai', model: 'gpt-4.1' },
      reviewer: { provider: 'google', model: 'gemini-2.5-pro' },
      polisher: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    };
  }
  if (has('anthropic')) {
    return {
      planner: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      worker: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      reviewer: { provider: 'anthropic', model: 'claude-opus-4-1' },
      polisher: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    };
  }
  if (has('openai')) {
    return {
      planner: { provider: 'openai', model: 'gpt-4.1' },
      worker: { provider: 'openai', model: 'gpt-4.1' },
      reviewer: { provider: 'openai', model: 'gpt-4.1' },
      polisher: { provider: 'openai', model: 'gpt-4.1' },
    };
  }
  if (has('google')) {
    return {
      planner: { provider: 'google', model: 'gemini-2.5-pro' },
      worker: { provider: 'google', model: 'gemini-2.5-pro' },
      reviewer: { provider: 'google', model: 'gemini-2.5-pro' },
      polisher: { provider: 'google', model: 'gemini-2.5-pro' },
    };
  }
  return {
    planner: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    worker: { provider: 'openai', model: 'gpt-4.1' },
    reviewer: { provider: 'google', model: 'gemini-2.5-pro' },
    polisher: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  };
}
