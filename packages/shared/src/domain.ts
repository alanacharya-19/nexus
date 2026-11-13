/**
 * NEXUS shared domain contracts.
 *
 * These types are the single source of truth shared by the API and the mobile
 * client. Runtime validation lives in `schemas.ts`.
 */

import type { RunEvent } from './events.js';

export const PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const AGENT_ROLES = ['planner', 'worker', 'reviewer', 'polisher', 'custom'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const RUN_STATUSES = [
  'queued',
  'running',
  'paused',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STAGES = ['plan', 'work', 'review', 'revise', 'polish', 'deliver'] as const;
export type RunStage = (typeof RUN_STAGES)[number];

/**
 * Explicit, persisted orchestration states. `RunStatus` remains the
 * user-facing lifecycle status (for backwards compatibility) while
 * `ExecutionState` describes exactly what the multi-agent engine is doing.
 */
export const EXECUTION_STATES = [
  'queued',
  'planning',
  'executing',
  'reviewing',
  'revising',
  'polishing',
  'awaiting_approval',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const AGENT_EXECUTION_STATUSES = [
  'idle',
  'activated',
  'thinking',
  'working',
  'completed',
  'failed',
] as const;
export type AgentExecutionStatus = (typeof AGENT_EXECUTION_STATUSES)[number];

export const APPROVAL_MODES = ['always', 'key', 'auto'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const ARTIFACT_KINDS = ['document', 'code', 'deliverable'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const STEP_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const MESSAGE_ROLES = ['system', 'user', 'assistant'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_STATUSES = [
  'pending',
  'streaming',
  'complete',
  'cancelled',
  'error',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Where token counts came from. Estimates are never presented as billing data. */
export const USAGE_SOURCES = ['provider', 'estimated'] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

export interface User {
  id: string;
  email: string;
  name: string | null;
  displayName?: string | null;
  defaultProvider?: ProviderId | null;
  defaultModel?: string | null;
  createdAt: string;
}

export interface AiPreferences {
  defaultProvider: ProviderId | null;
  defaultModel: string | null;
}

export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
  source: UsageSource;
}

export interface MessageError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface MessageMetadata {
  status: MessageStatus;
  provider?: ProviderId;
  model?: string;
  usage?: MessageUsage | null;
  costUsd?: number;
  costEstimated?: boolean;
  latencyMs?: number;
  finishReason?: string | null;
  error?: MessageError | null;
  [key: string]: unknown;
}

export interface Conversation {
  id: string;
  userId: string;
  projectId: string | null;
  projectName?: string | null;
  title: string;
  provider: ProviderId;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string | null;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: MessageRole;
  content: string;
  metadata: MessageMetadata;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: ConversationMessage[];
}

/**
 * Server-sent frames for a conversation response. `index` is a monotonic
 * counter so reconnecting clients can request everything after what they saw.
 */
export type ChatStreamMessage =
  | {
      event: 'stream.ready';
      data: {
        conversationId: string;
        messageId: string;
        status: MessageStatus;
        content: string;
        lastIndex: number;
      };
    }
  | {
      event: 'message.delta';
      data: { messageId: string; index: number; delta: string };
    }
  | {
      event: 'message.usage';
      data: {
        messageId: string;
        inputTokens: number;
        outputTokens: number;
        source: UsageSource;
      };
    }
  | {
      event: 'message.status';
      data: { messageId: string; status: MessageStatus };
    }
  | {
      event: 'message.done';
      data: {
        messageId: string;
        status: MessageStatus;
        usage: MessageUsage | null;
        costUsd: number;
        costEstimated: boolean;
        latencyMs: number;
        finishReason: string | null;
      };
    }
  | {
      event: 'message.error';
      data: {
        messageId: string;
        code: string;
        message: string;
        retryable: boolean;
      };
    }
  | { event: 'stream.heartbeat'; data: { at: string } };

export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
  runCount?: number;
}

export interface Agent {
  id: string;
  userId: string;
  name: string;
  role: AgentRole;
  provider: ProviderId;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  accent: string;
  isDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Immutable agent configuration captured when a run starts. */
export interface RunAgent {
  agentId: string;
  name: string;
  role: AgentRole;
  provider: ProviderId;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  accent: string;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  assigneeRole: AgentRole;
  expectedOutput: string;
  dependsOn: number[];
  status: StepStatus;
  outputArtifactId?: string | null;
  /** How the engine (and reviewer) will judge this subtask as complete. */
  acceptanceCriteria?: string[];
  /** Resolved from the run's frozen agent roster when the plan is created. */
  assignedAgentId?: string | null;
  /** Bounded work attempts. Used to prevent accidental re-execution. */
  attempts?: number;
  /** Reviewer guidance applied on the most recent revision. */
  reviewFeedback?: string[];
}

export interface RunPlan {
  summary: string;
  approach: string;
  steps: PlanStep[];
  risks: string[];
  /** Requirements and constraints extracted by the planner. */
  requirements?: string[];
  constraints?: string[];
  /** Named deliverables the pipeline promises to produce. */
  deliverables?: string[];
  createdAt: string;
}

/** Per-agent, independently persisted execution status and output history. */
export interface AgentExecutionOutput {
  artifactId: string | null;
  name: string;
  kind: ArtifactKind;
  summary: string;
  createdAt: string;
}

export interface AgentExecutionState {
  agentId: string;
  name: string;
  role: AgentRole;
  status: AgentExecutionStatus;
  currentTask: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastOutput: string | null;
  outputs: AgentExecutionOutput[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
}

export type ReviewSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ReviewIssue {
  severity: ReviewSeverity;
  area: string;
  description: string;
  suggestion: string;
}

export interface RunReview {
  verdict: 'approve' | 'revise';
  score: number;
  summary: string;
  strengths: string[];
  issues: ReviewIssue[];
  requiredChanges: string[];
  round: number;
  createdAt: string;
  contradictions?: string[];
  missingRequirements?: string[];
  reviewedArtifactIds?: string[];
}

export interface PendingApproval {
  stage: RunStage;
  title: string;
  summary: string;
  requestedAt: string;
}

export interface Run {
  id: string;
  userId: string;
  projectId: string | null;
  projectName?: string | null;
  title: string;
  objective: string;
  templateId: string | null;
  status: RunStatus;
  stage: RunStage;
  /** Explicit engine state. Persisted independently of the legacy status. */
  executionState: ExecutionState;
  approvalMode: ApprovalMode;
  agents: RunAgent[];
  plan: RunPlan | null;
  review: RunReview | null;
  pendingApproval: PendingApproval | null;
  currentStep: number;
  reviewRound: number;
  revisionCount: number;
  maxReviewRounds: number;
  maxDurationMs: number;
  maxTotalTokens: number;
  maxCostUsd: number;
  currentAgentId: string | null;
  currentTask: string | null;
  agentStates: Record<string, AgentExecutionState>;
  error: string | null;
  errorCode: string | null;
  totalTokens: number;
  totalCostUsd: number;
  finalArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  executionStartedAt: string | null;
  completedAt: string | null;
  isLive?: boolean;
}

export interface Artifact {
  id: string;
  runId: string;
  runTitle?: string | null;
  userId: string;
  name: string;
  kind: ArtifactKind;
  mimeType: string;
  content: string;
  version: number;
  createdByAgentId: string | null;
  agentName?: string | null;
  stepId: string | null;
  createdAt: string;
}

export interface RunInstruction {
  id: string;
  runId: string;
  content: string;
  stage: RunStage;
  consumed: boolean;
  createdAt: string;
}

export interface UsageRecord {
  id: string;
  runId: string | null;
  conversationId: string | null;
  messageId: string | null;
  agentId: string | null;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'success' | 'error';
  usageSource: UsageSource;
  costEstimated: boolean;
  createdAt: string;
}

export interface UsageBucket {
  key: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costUsd: number;
  calls: number;
}

export interface UsageSummary {
  from: string;
  to: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  calls: number;
  byProvider: UsageBucket[];
  byModel: UsageBucket[];
  byDay: UsageBucket[];
  byAgent: UsageBucket[];
}

export interface CredentialStatus {
  provider: ProviderId;
  configured: boolean;
  source: 'user' | 'server' | null;
  hint: string | null;
  lastValidatedAt: string | null;
}

export interface LiveAgentOutput {
  runId: string;
  agentId: string;
  agentName: string;
  stage: RunStage;
  text: string;
  startedAt: string;
  status?: AgentExecutionStatus;
}

export interface RunDetail {
  run: Run;
  events: RunEvent[];
  artifacts: Artifact[];
  instructions: RunInstruction[];
  live: LiveAgentOutput | null;
}

export interface WorkflowTemplate {
  id: string;
  userId: string | null;
  name: string;
  description: string;
  category: string;
  icon: string;
  objectiveTemplate: string;
  guidance: string;
  suggestedApprovalMode: ApprovalMode;
  isBuiltin: boolean;
  createdAt: string;
}

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  label: string;
  description: string;
  tier: 'frontier' | 'balanced' | 'fast';
  contextWindow: number;
  maxOutput: number;
  /** USD per million tokens. */
  inputPrice: number;
  outputPrice: number;
  supportsJson: boolean;
}

export interface AgentDefaults {
  role: AgentRole;
  name: string;
  systemPrompt: string;
  accent: string;
}

// ---------------------------------------------------------------------------
// Structured agent-to-agent communication
// ---------------------------------------------------------------------------

export type AgentRequestKind = 'plan' | 'execute' | 'review' | 'revise' | 'polish';

/** Validated envelope passed to one agent for one unit of work. */
export interface AgentRequest {
  id: string;
  runId: string;
  agentId: string;
  role: AgentRole;
  kind: AgentRequestKind;
  objective: string;
  task: string;
  constraints: string[];
  contextSummary: string;
  expectedOutput: string;
  createdAt: string;
}

export interface AgentResponseUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Validated envelope returned by an agent after a provider call. */
export interface AgentResponse {
  requestId: string;
  runId: string;
  agentId: string;
  role: AgentRole;
  status: 'completed' | 'partial' | 'failed';
  output: string;
  structured: Record<string, unknown> | null;
  incomplete: string[];
  usage: AgentResponseUsage;
  provider: ProviderId;
  model: string;
  error: string | null;
  startedAt: string;
  completedAt: string;
}

/** Zod-validated plan produced by the Planner agent. */
export interface ExecutionPlan {
  summary: string;
  approach: string;
  requirements: string[];
  constraints: string[];
  deliverables: string[];
  steps: PlanStep[];
  risks: string[];
  createdAt: string;
}

/** One assigned unit of work, including its acceptance criteria. */
export interface Subtask {
  id: string;
  title: string;
  description: string;
  assigneeRole: AgentRole;
  assignedAgentId: string | null;
  expectedOutput: string;
  acceptanceCriteria: string[];
  dependsOn: number[];
  status: StepStatus;
  attempts: number;
  outputArtifactId: string | null;
}

/** Reviewer's structured verdict over actual worker artifacts. */
export interface ReviewReport extends RunReview {
  approved: boolean;
  reviewedArtifactIds: string[];
  contradictions: string[];
  missingRequirements: string[];
}

/** Validated instruction handed from Reviewer to Worker. */
export interface RevisionInstruction {
  id: string;
  runId: string;
  round: number;
  reviewId: string;
  requiredChanges: string[];
  issues: ReviewIssue[];
  sourceArtifactIds: string[];
  createdAt: string;
}

/** Validated final document produced by the Polisher. */
export interface FinalDeliverable {
  title: string;
  content: string;
  summary: string;
  sources: string[];
  reviewScore: number | null;
  unresolvedIssues: string[];
  createdAt: string;
}

export interface ExecutionLimits {
  maxReviewRounds: number;
  maxDurationMs: number;
  maxTotalTokens: number;
  maxCostUsd: number;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  user: User;
  mode: 'supabase' | 'local';
}

export interface ServerCapabilities {
  name: string;
  version: string;
  authModes: ('supabase' | 'local')[];
  providers: { provider: ProviderId; serverKey: boolean }[];
  limits: { maxConcurrentRuns: number; maxObjectiveLength: number };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
