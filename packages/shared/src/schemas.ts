import { z } from 'zod';
import {
  AGENT_EXECUTION_STATUSES,
  AGENT_ROLES,
  APPROVAL_MODES,
  ARTIFACT_KINDS,
  EXECUTION_STATES,
  PROVIDERS,
  RUN_STAGES,
  RUN_STATUSES,
  STEP_STATUSES,
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
export const executionStateSchema = z.enum(EXECUTION_STATES);
export const agentExecutionStatusSchema = z.enum(AGENT_EXECUTION_STATUSES);
export const stepStatusSchema = z.enum(STEP_STATUSES);

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
  /** Optional per-run execution guardrails. Server defaults apply when omitted. */
  maxReviewRounds: z.number().int().min(1).max(10).optional(),
  maxDurationMs: z.number().int().min(60_000).max(86_400_000).optional(),
  maxTotalTokens: z.number().int().min(1_000).max(10_000_000).optional(),
  maxCostUsd: z.number().min(0).max(1_000).optional(),
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
  requirements: z.array(z.string().trim().min(3).max(500)).max(20).default([]),
  constraints: z.array(z.string().trim().min(3).max(500)).max(20).default([]),
  deliverables: z.array(z.string().trim().min(3).max(300)).max(12).default([]),
  steps: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().min(10).max(2_000),
        assigneeRole: z.enum(['worker', 'reviewer', 'polisher', 'custom']),
        expectedOutput: z.string().trim().min(5).max(500),
        acceptanceCriteria: z
          .array(z.string().trim().min(3).max(400))
          .max(8)
          .default([]),
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
  contradictions: z.array(z.string().trim().min(3).max(600)).max(12).default([]),
  missingRequirements: z.array(z.string().trim().min(3).max(600)).max(12).default([]),
});

export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

// ---------------------------------------------------------------------------
// Orchestration contracts. Every value crossing an agent boundary is parsed
// with one of these schemas before the engine trusts it.
// ---------------------------------------------------------------------------

const shortText = z.string().trim().min(1).max(4_000);
const longText = z.string().trim().min(1).max(200_000);

export const agentRequestKindSchema = z.enum([
  'plan',
  'execute',
  'review',
  'revise',
  'polish',
]);

export const agentRequestSchema = z.object({
  id: z.string().min(1).max(120),
  runId: idSchema,
  agentId: z.string().min(1).max(120),
  role: agentRoleSchema,
  kind: agentRequestKindSchema,
  objective: longText,
  task: shortText,
  constraints: z.array(z.string().trim().min(1).max(1_000)).max(40).default([]),
  contextSummary: z.string().max(40_000).default(''),
  expectedOutput: z.string().max(2_000).default(''),
  createdAt: z.string().datetime(),
});

export const agentResponseUsageSchema = z.object({
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
});

export const agentResponseSchema = z.object({
  requestId: z.string().min(1).max(120),
  runId: idSchema,
  agentId: z.string().min(1).max(120),
  role: agentRoleSchema,
  status: z.enum(['completed', 'partial', 'failed']),
  output: z.string().max(400_000).default(''),
  structured: z.record(z.string(), z.unknown()).nullable().default(null),
  incomplete: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  usage: agentResponseUsageSchema,
  provider: providerSchema,
  model: z.string().trim().min(1).max(200),
  error: z.string().max(4_000).nullable().default(null),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});

export const subtaskSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(4_000),
  assigneeRole: agentRoleSchema,
  assignedAgentId: z.string().min(1).max(120).nullable().default(null),
  expectedOutput: z.string().trim().min(5).max(1_000),
  acceptanceCriteria: z.array(z.string().trim().min(3).max(1_000)).max(20).default([]),
  dependsOn: z.array(z.number().int().min(0).max(64)).max(12).default([]),
  status: stepStatusSchema.default('pending'),
  attempts: z.number().int().min(0).max(10).default(0),
  outputArtifactId: z.string().uuid().nullable().default(null),
});

export const executionPlanSchema = z.object({
  summary: z.string().trim().min(10).max(2_000),
  approach: z.string().trim().min(10).max(4_000),
  requirements: z.array(z.string().trim().min(1).max(1_000)).max(40).default([]),
  constraints: z.array(z.string().trim().min(1).max(1_000)).max(40).default([]),
  deliverables: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  steps: z.array(subtaskSchema).min(1).max(20),
  risks: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  createdAt: z.string().datetime(),
});

export const reviewIssueSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  area: z.string().trim().min(2).max(200),
  description: z.string().trim().min(5).max(2_000),
  suggestion: z.string().trim().min(3).max(2_000),
});

export const reviewReportSchema = z.object({
  verdict: z.enum(['approve', 'revise']),
  approved: z.boolean(),
  score: z.number().int().min(0).max(100),
  summary: z.string().trim().min(10).max(4_000),
  strengths: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  issues: z.array(reviewIssueSchema).max(30).default([]),
  requiredChanges: z.array(z.string().trim().min(1).max(2_000)).max(30).default([]),
  contradictions: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
  missingRequirements: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
  reviewedArtifactIds: z.array(z.string().uuid()).max(100).default([]),
  round: z.number().int().min(1).max(100),
  createdAt: z.string().datetime(),
});

export const revisionInstructionSchema = z.object({
  id: z.string().min(1).max(120),
  runId: idSchema,
  round: z.number().int().min(1).max(100),
  reviewId: z.string().min(1).max(120),
  requiredChanges: z.array(z.string().trim().min(1).max(2_000)).max(30).default([]),
  issues: z.array(reviewIssueSchema).max(30).default([]),
  sourceArtifactIds: z.array(z.string().uuid()).max(100).default([]),
  createdAt: z.string().datetime(),
});

/** What the Polisher model must return. Server-owned fields are added later. */
export const polisherOutputSchema = z.object({
  title: z.string().trim().min(3).max(300),
  content: z.string().trim().min(100).max(400_000),
  summary: z.string().trim().min(10).max(4_000),
  sources: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  unresolvedIssues: z.array(z.string().trim().min(1).max(2_000)).max(30).default([]),
});

export type PolisherOutput = z.infer<typeof polisherOutputSchema>;

export const finalDeliverableSchema = polisherOutputSchema.extend({
  reviewScore: z.number().int().min(0).max(100).nullable().default(null),
  createdAt: z.string().datetime(),
});

export const agentExecutionOutputSchema = z.object({
  artifactId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(300),
  kind: artifactKindSchema,
  summary: z.string().max(2_000),
  createdAt: z.string().datetime(),
});

export const agentExecutionStateSchema = z.object({
  agentId: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  role: agentRoleSchema,
  status: agentExecutionStatusSchema,
  currentTask: z.string().max(2_000).nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  lastOutput: z.string().max(4_000).nullable(),
  outputs: z.array(agentExecutionOutputSchema).max(100).default([]),
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  error: z.string().max(4_000).nullable(),
});

export const executionLimitsSchema = z.object({
  maxReviewRounds: z.number().int().min(1).max(10).default(3),
  maxDurationMs: z.number().int().min(10_000).max(86_400_000).default(1_800_000),
  maxTotalTokens: z.number().int().min(1_000).max(10_000_000).default(500_000),
  maxCostUsd: z.number().min(0).max(1_000).default(3),
});

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
