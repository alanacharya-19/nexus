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

export const APPROVAL_MODES = ['always', 'key', 'auto'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const ARTIFACT_KINDS = ['document', 'code', 'deliverable'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const STEP_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

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
}

export interface RunPlan {
  summary: string;
  approach: string;
  steps: PlanStep[];
  risks: string[];
  createdAt: string;
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
  approvalMode: ApprovalMode;
  agents: RunAgent[];
  plan: RunPlan | null;
  review: RunReview | null;
  pendingApproval: PendingApproval | null;
  currentStep: number;
  reviewRound: number;
  revisionCount: number;
  error: string | null;
  errorCode: string | null;
  totalTokens: number;
  totalCostUsd: number;
  finalArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  isLive?: boolean;
}

export interface Artifact {
  id: string;
  runId: string;
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
  agentId: string | null;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'success' | 'error';
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
