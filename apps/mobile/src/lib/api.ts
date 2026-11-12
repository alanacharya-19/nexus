import type {
  Agent,
  AgentRole,
  AiPreferences,
  ApprovalMode,
  Artifact,
  AuthSession,
  Conversation,
  ConversationDetail,
  ConversationMessage,
  CredentialStatus,
  ModelInfo,
  Project,
  ProviderId,
  Run,
  RunDetail,
  RunEvent,
  RunStatus,
  ServerCapabilities,
  UsageRecord,
  UsageSummary,
  WorkflowTemplate,
} from '@nexus/shared';
import { DEFAULT_API_URL } from './config';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(input: {
    message: string;
    code: string;
    status: number;
    details?: unknown;
    requestId?: string | null;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.requestId = input.requestId ?? null;
  }
}

let baseUrl = DEFAULT_API_URL;
let authToken: string | null = null;

export function configureApi(next: { baseUrl?: string; token?: string | null }): void {
  if (next.baseUrl !== undefined) baseUrl = next.baseUrl.replace(/\/+$/, '');
  if (next.token !== undefined) authToken = next.token;
}

export function getApiBaseUrl(): string {
  return baseUrl;
}

export function getAuthToken(): string | null {
  return authToken;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  raw?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const headers: Record<string, string> = {
    accept: 'application/json',
    ...options.headers,
  };
  const token = options.token === undefined ? authToken : options.token;
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (options.raw) {
      if (!response.ok) throw await toApiError(response);
      return (await response.text()) as T;
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      throw fromBody(parsed, response.status);
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      if (options.signal?.aborted) throw error;
      throw new ApiError({
        code: 'TIMEOUT',
        status: 0,
        message: 'The server took too long to respond. Check your connection and try again.',
      });
    }
    throw new ApiError({
      code: 'NETWORK',
      status: 0,
      message:
        'Could not reach the NEXUS server. Check your connection and the server address in Settings.',
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '');
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return fromBody(parsed, response.status);
}

function fromBody(body: unknown, status: number): ApiError {
  const record = body as
    | {
        error?: {
          code?: string;
          message?: string;
          details?: unknown;
          requestId?: string;
        };
        message?: string;
      }
    | null;
  const error = record?.error;
  return new ApiError({
    status,
    code: error?.code ?? `HTTP_${status}`,
    message:
      error?.message ??
      record?.message ??
      (status === 401
        ? 'Your session has expired. Sign in again.'
        : 'The request failed. Try again.'),
    details: error?.details,
    requestId: error?.requestId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const api = {
  capabilities: () => request<ServerCapabilities>('/capabilities', { token: null }),

  devSignIn: (input: { email: string; name?: string }) =>
    request<AuthSession>('/auth/dev', {
      method: 'POST',
      body: input,
      token: null,
    }),

  me: () => request<{ user: AuthSession['user']; mode: 'supabase' | 'local' }>('/auth/me'),

  // Models
  models: () =>
    request<{ models: ModelInfo[]; providers: Record<string, unknown> }>('/models'),

  // Agents
  listAgents: () => request<{ agents: Agent[] }>('/agents'),
  createAgent: (input: {
    name: string;
    role: AgentRole;
    provider: ProviderId;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    accent: string;
  }) => request<{ agent: Agent }>('/agents', { method: 'POST', body: input }),
  updateAgent: (
    id: string,
    input: Partial<{
      name: string;
      provider: ProviderId;
      model: string;
      systemPrompt: string;
      temperature: number;
      maxTokens: number;
      accent: string;
      enabled: boolean;
    }>
  ) => request<{ agent: Agent }>(`/agents/${id}`, { method: 'PATCH', body: input }),
  deleteAgent: (id: string) =>
    request<{ deleted: true }>(`/agents/${id}`, { method: 'DELETE' }),

  // Projects
  listProjects: () => request<{ projects: Project[] }>('/projects'),
  createProject: (input: {
    name: string;
    description?: string | null;
    color?: string;
  }) => request<{ project: Project }>('/projects', { method: 'POST', body: input }),
  updateProject: (
    id: string,
    input: Partial<{ name: string; description: string | null; color: string }>
  ) => request<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', body: input }),
  deleteProject: (id: string) =>
    request<{ deleted: true }>(`/projects/${id}`, { method: 'DELETE' }),

  // Templates
  listTemplates: () => request<{ templates: WorkflowTemplate[] }>('/templates'),
  createTemplate: (input: {
    name: string;
    description: string;
    category: string;
    icon: string;
    objectiveTemplate: string;
    guidance: string;
    suggestedApprovalMode: ApprovalMode;
  }) => request<{ template: WorkflowTemplate }>('/templates', { method: 'POST', body: input }),
  deleteTemplate: (id: string) =>
    request<{ deleted: true }>(`/templates/${id}`, { method: 'DELETE' }),

  // Runs
  listRuns: (query: {
    status?: RunStatus;
    search?: string;
    projectId?: string;
    limit?: number;
    cursor?: string;
  } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ runs: Run[]; nextCursor: string | null }>(`/runs${suffix}`);
  },
  createRun: (input: {
    objective: string;
    title?: string;
    projectId?: string | null;
    templateId?: string | null;
    approvalMode: ApprovalMode;
    agents?: { agentId: string; provider?: ProviderId; model?: string }[];
  }) => request<{ run: Run }>('/runs', { method: 'POST', body: input }),
  getRun: (id: string) => request<RunDetail>(`/runs/${id}`),
  updateRun: (id: string, input: { title?: string; projectId?: string | null }) =>
    request<{ run: Run }>(`/runs/${id}`, { method: 'PATCH', body: input }),
  deleteRun: (id: string) => request<{ deleted: true }>(`/runs/${id}`, { method: 'DELETE' }),
  startRun: (id: string) => request<{ run: Run }>(`/runs/${id}/start`, { method: 'POST' }),
  pauseRun: (id: string) => request<{ run: Run }>(`/runs/${id}/pause`, { method: 'POST' }),
  resumeRun: (id: string) => request<{ run: Run }>(`/runs/${id}/resume`, { method: 'POST' }),
  cancelRun: (id: string, reason?: string) =>
    request<{ run: Run }>(`/runs/${id}/cancel`, { method: 'POST', body: { reason } }),
  retryRun: (id: string, restartStage = false) =>
    request<{ run: Run }>(`/runs/${id}/retry`, {
      method: 'POST',
      body: { restartStage },
    }),
  approveRun: (id: string, decision: 'approve' | 'reject', note?: string) =>
    request<{ run: Run }>(`/runs/${id}/approve`, {
      method: 'POST',
      body: { decision, note },
    }),
  steerRun: (id: string, content: string) =>
    request<{ run: Run }>(`/runs/${id}/instructions`, {
      method: 'POST',
      body: { content },
    }),
  listEvents: (id: string, afterSeq = 0, limit = 500) =>
    request<{ events: RunEvent[] }>(`/runs/${id}/events?afterSeq=${afterSeq}&limit=${limit}`),
  streamToken: (id: string) =>
    request<{ token: string; expiresIn: number }>(`/runs/${id}/stream-token`, {
      method: 'POST',
    }),

  // Conversations
  listConversations: (
    query: { projectId?: string; search?: string; limit?: number; cursor?: string } = {}
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ conversations: Conversation[]; nextCursor: string | null }>(
      `/conversations${suffix}`
    );
  },
  createConversation: (input: {
    title?: string;
    projectId?: string | null;
    provider?: ProviderId;
    model?: string;
  }) => request<{ conversation: Conversation }>('/conversations', {
    method: 'POST',
    body: input,
  }),
  getConversation: (id: string) =>
    request<ConversationDetail>(`/conversations/${id}`),
  updateConversation: (
    id: string,
    input: Partial<{
      title: string;
      projectId: string | null;
      provider: ProviderId;
      model: string;
    }>
  ) => request<{ conversation: Conversation }>(`/conversations/${id}`, {
    method: 'PATCH',
    body: input,
  }),
  deleteConversation: (id: string) =>
    request<{ deleted: true }>(`/conversations/${id}`, { method: 'DELETE' }),
  listMessages: (id: string, limit = 500) =>
    request<{ messages: ConversationMessage[] }>(
      `/conversations/${id}/messages?limit=${limit}`
    ),
  sendMessage: (
    id: string,
    input: {
      content: string;
      provider?: ProviderId;
      model?: string;
      deviceKey?: string | null;
    }
  ) =>
    request<{
      userMessage: ConversationMessage;
      assistantMessage: ConversationMessage;
      streamToken: string;
      expiresIn: number;
    }>(`/conversations/${id}/messages`, {
      method: 'POST',
      body: {
        content: input.content,
        provider: input.provider,
        model: input.model,
      },
      headers: input.deviceKey ? { 'x-provider-key': input.deviceKey } : undefined,
      timeoutMs: 60_000,
    }),
  cancelMessage: (conversationId: string, messageId: string) =>
    request<{ cancelled: boolean }>(
      `/conversations/${conversationId}/messages/${messageId}/cancel`,
      { method: 'POST' }
    ),
  conversationStreamToken: (id: string) =>
    request<{ token: string; expiresIn: number }>(
      `/conversations/${id}/stream-token`,
      { method: 'POST' }
    ),

  // AI preferences
  aiPreferences: () =>
    request<{ preferences: AiPreferences }>('/preferences/ai'),
  saveAiPreferences: (input: {
    defaultProvider?: ProviderId | null;
    defaultModel?: string | null;
  }) =>
    request<{ preferences: AiPreferences }>('/preferences/ai', {
      method: 'PUT',
      body: input,
    }),

  // Artifacts
  listArtifacts: (limit = 50) =>
    request<{ artifacts: Artifact[] }>(`/artifacts?limit=${limit}`),
  getArtifact: (id: string) => request<{ artifact: Artifact }>(`/artifacts/${id}`),
  exportArtifact: (id: string, format: 'md' | 'txt' | 'json') =>
    request<string>(`/artifacts/${id}/export?format=${format}`, { raw: true }),
  deleteArtifact: (id: string) =>
    request<{ deleted: true }>(`/artifacts/${id}`, { method: 'DELETE' }),

  // Usage
  usageSummary: (days: number) =>
    request<{ summary: UsageSummary }>(`/usage/summary?days=${days}`),
  usageRecords: (limit = 100) =>
    request<{ records: UsageRecord[] }>(`/usage/records?limit=${limit}`),

  // Credentials
  listCredentials: () => request<{ credentials: CredentialStatus[] }>('/credentials'),
  saveCredential: (provider: ProviderId, apiKey: string) =>
    request<{ credential: CredentialStatus }>(`/credentials/${provider}`, {
      method: 'PUT',
      body: { apiKey },
    }),
  testCredential: (provider: ProviderId, apiKey: string) =>
    request<{ ok: boolean; message?: string }>(`/credentials/${provider}/test`, {
      method: 'POST',
      body: { apiKey },
    }),
  deleteCredential: (provider: ProviderId) =>
    request<{ deleted: true }>(`/credentials/${provider}`, { method: 'DELETE' }),
};

export function streamUrl(runId: string, token: string, lastEventId: number): string {
  const params = new URLSearchParams({ token, lastEventId: String(lastEventId) });
  return `${baseUrl}/runs/${runId}/stream?${params.toString()}`;
}

export function conversationStreamUrl(
  conversationId: string,
  messageId: string,
  token: string,
  lastIndex: number
): string {
  const params = new URLSearchParams({
    token,
    lastIndex: String(lastIndex),
  });
  return `${baseUrl}/conversations/${conversationId}/messages/${messageId}/stream?${params.toString()}`;
}
