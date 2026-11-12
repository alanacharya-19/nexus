import { z } from 'zod';
import {
  AGENT_ROLES,
  APPROVAL_MODES,
  ARTIFACT_KINDS,
  PROVIDERS,
  RUN_STAGES,
  RUN_STATUSES,
} from './domain.js';

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a six-digit hex color');

export const providerSchema = z.enum(PROVIDERS);
export const agentRoleSchema = z.enum(AGENT_ROLES);
export const approvalModeSchema = z.enum(APPROVAL_MODES);
export const runStatusSchema = z.enum(RUN_STATUSES);
export const runStageSchema = z.enum(RUN_STAGES);
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);

export const idSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const devAuthSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(80).optional(),
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullish(),
  color: hexColor.default('#A8C7FA'),
});

export const updateProjectSchema = createProjectSchema.partial();

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  role: agentRoleSchema,
  provider: providerSchema,
  model: z.string().trim().min(1).max(120),
  systemPrompt: z.string().trim().min(20).max(20_000),
  temperature: z.number().min(0).max(2).default(0.4),
  maxTokens: z.number().int().min(256).max(64_000).default(4_096),
  accent: hexColor.default('#A8C7FA'),
  enabled: z.boolean().default(true),
});

export const updateAgentSchema = createAgentSchema.partial();

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(400),
  category: z.string().trim().min(1).max(40),
  icon: z.string().trim().min(1).max(40).default('sparkles'),
  objectiveTemplate: z.string().trim().min(10).max(10_000),
  guidance: z.string().trim().max(4_000).default(''),
  suggestedApprovalMode: approvalModeSchema.default('key'),
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const runAgentInputSchema = z.object({
  agentId: idSchema,
  provider: providerSchema.optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

export const createRunSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  objective: z.string().trim().min(12).max(20_000),
  projectId: idSchema.nullish(),
  templateId: z.string().trim().min(1).max(120).nullish(),
  approvalMode: approvalModeSchema.default('key'),
  agents: z.array(runAgentInputSchema).max(12).optional(),
});

export const updateRunSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  projectId: idSchema.nullish(),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(4_000).nullish(),
});

export const instructionSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
});

export const retryRunSchema = z.object({
  /** Retry from the beginning of the current stage rather than the failed step. */
  restartStage: z.boolean().default(false),
});

export const listRunsQuerySchema = z.object({
  projectId: idSchema.optional(),
  status: runStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// Conversations and chat
// ---------------------------------------------------------------------------

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  projectId: idSchema.nullish(),
  provider: providerSchema.optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

export const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  projectId: idSchema.nullish(),
  provider: providerSchema.optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

export const listConversationsQuerySchema = z.object({
  projectId: idSchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().datetime().optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  provider: providerSchema.optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

export const aiPreferencesSchema = z.object({
  defaultProvider: providerSchema.nullish(),
  defaultModel: z.string().trim().min(1).max(120).nullish(),
});

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const credentialSchema = z.object({
  apiKey: z.string().trim().min(10).max(400),
});

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export const usageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

// ---------------------------------------------------------------------------
// AI structured outputs (validated before they are trusted)
// ---------------------------------------------------------------------------

export const plannerOutputSchema = z.object({
  summary: z.string().trim().min(10).max(1_200),
  approach: z.string().trim().min(10).max(2_000),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().min(10).max(2_000),
        assigneeRole: z.enum(['worker', 'reviewer', 'polisher', 'custom']),
        expectedOutput: z.string().trim().min(5).max(500),
        dependsOn: z.array(z.number().int().min(0).max(11)).max(6).default([]),
      })
    )
    .min(2)
    .max(8),
  risks: z.array(z.string().trim().min(3).max(300)).max(8).default([]),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export const reviewOutputSchema = z.object({
  verdict: z.enum(['approve', 'revise']),
  score: z.number().int().min(0).max(100),
  summary: z.string().trim().min(10).max(1_200),
  strengths: z.array(z.string().trim().min(2).max(300)).max(8).default([]),
  issues: z
    .array(
      z.object({
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        area: z.string().trim().min(2).max(80),
        description: z.string().trim().min(5).max(600),
        suggestion: z.string().trim().min(3).max(600),
      })
    )
    .max(12)
    .default([]),
  requiredChanges: z.array(z.string().trim().min(3).max(600)).max(12).default([]),
});

export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

export const providerErrorSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      type: z.string().optional(),
      code: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  message: z.string().optional(),
});

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
