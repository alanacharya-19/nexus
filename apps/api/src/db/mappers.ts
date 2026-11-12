import type {
  Agent,
  Artifact,
  Conversation,
  ConversationMessage,
  MessageMetadata,
  Project,
  Run,
  RunInstruction,
  UsageRecord,
  User,
  WorkflowTemplate,
} from '@nexus/shared';

export type Row = Record<string, any>;

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function mapUser(row: Row): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    displayName: row.display_name ?? row.name ?? null,
    defaultProvider: row.default_provider ?? null,
    defaultModel: row.default_model ?? null,
    createdAt: iso(row.created_at)!,
  };
}

export function mapProject(row: Row): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? null,
    color: row.color,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    runCount: row.run_count !== undefined ? Number(row.run_count) : undefined,
  };
}

export function mapAgent(row: Row): Agent {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    role: row.role,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.system_prompt,
    temperature: Number(row.temperature),
    maxTokens: Number(row.max_tokens),
    accent: row.accent,
    isDefault: Boolean(row.is_default),
    enabled: Boolean(row.enabled),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

export function mapRun(row: Row): Run {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id ?? null,
    projectName: row.project_name ?? null,
    title: row.title,
    objective: row.objective,
    templateId: row.template_id ?? null,
    status: row.status,
    stage: row.stage,
    approvalMode: row.approval_mode,
    agents: row.agents ?? [],
    plan: row.plan ?? null,
    review: row.review ?? null,
    pendingApproval: row.pending_approval ?? null,
    currentStep: Number(row.current_step ?? 0),
    reviewRound: Number(row.review_round ?? 0),
    revisionCount: Number(row.revision_count ?? 0),
    error: row.error ?? null,
    errorCode: row.error_code ?? null,
    totalTokens: Number(row.total_tokens ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? 0),
    finalArtifactId: row.final_artifact_id ?? null,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    isLive: false,
  };
}

export function mapArtifact(row: Row): Artifact {
  return {
    id: row.id,
    runId: row.run_id,
    userId: row.user_id,
    name: row.name,
    kind: row.kind,
    mimeType: row.mime_type,
    content: row.content,
    version: Number(row.version),
    createdByAgentId: row.created_by_agent_id ?? null,
    agentName: row.agent_name ?? null,
    stepId: row.step_id ?? null,
    createdAt: iso(row.created_at)!,
  };
}

export function mapInstruction(row: Row): RunInstruction {
  return {
    id: row.id,
    runId: row.run_id,
    content: row.content,
    stage: row.stage,
    consumed: Boolean(row.consumed),
    createdAt: iso(row.created_at)!,
  };
}

export function mapUsage(row: Row): UsageRecord {
  return {
    id: row.id,
    runId: row.run_id ?? null,
    conversationId: row.conversation_id ?? null,
    messageId: row.message_id ?? null,
    agentId: row.agent_id ?? null,
    provider: row.provider,
    model: row.model,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    costUsd: Number(row.cost_usd),
    latencyMs: Number(row.latency_ms),
    status: row.status,
    usageSource: row.usage_source ?? 'estimated',
    costEstimated: row.cost_estimated === undefined ? true : Boolean(row.cost_estimated),
    createdAt: iso(row.created_at)!,
  };
}

export function mapConversation(row: Row): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id ?? null,
    projectName: row.project_name ?? null,
    title: row.title,
    provider: row.provider,
    model: row.model,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    messageCount:
      row.message_count !== undefined ? Number(row.message_count) : undefined,
    lastMessage: row.last_message ?? null,
  };
}

export function mapMessage(row: Row): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role,
    content: row.content ?? '',
    metadata: (row.metadata ?? { status: 'complete' }) as MessageMetadata,
    createdAt: iso(row.created_at)!,
  };
}

export function mapTemplate(row: Row): WorkflowTemplate {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    objectiveTemplate: row.objective_template,
    guidance: row.guidance,
    suggestedApprovalMode: row.suggested_approval_mode,
    isBuiltin: false,
    createdAt: iso(row.created_at)!,
  };
}
