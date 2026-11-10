import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import type {
  Agent,
  AgentRole,
  ApprovalMode,
  ProviderId,
  RunStatus,
} from '@nexus/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { toast } from '@/stores/toast';

export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: () => api.listAgents().then((data) => data.agents),
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => api.listProjects().then((data) => data.projects),
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: queryKeys.templates,
    queryFn: () => api.listTemplates().then((data) => data.templates),
  });
}

export interface RunFilters {
  status?: RunStatus;
  search?: string;
  projectId?: string;
}

export function useRuns(filters: RunFilters = {}) {
  const key = JSON.stringify(filters);
  return useQuery({
    queryKey: queryKeys.runs(key),
    queryFn: () => api.listRuns({ ...filters, limit: 50 }),
    placeholderData: (previous) => previous,
  });
}

export function useRunDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.run(id),
    queryFn: () => api.getRun(id),
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'running' || status === 'awaiting_approval' || status === 'queued'
        ? 6_000
        : false;
    },
  });
}

export function useArtifacts(limit = 50) {
  return useQuery({
    queryKey: [...queryKeys.artifacts, limit],
    queryFn: () => api.listArtifacts(limit).then((data) => data.artifacts),
  });
}

export function useArtifact(id: string) {
  return useQuery({
    queryKey: queryKeys.artifact(id),
    queryFn: () => api.getArtifact(id).then((data) => data.artifact),
  });
}

export function useUsageSummary(days: number) {
  return useQuery({
    queryKey: queryKeys.usage(days),
    queryFn: () => api.usageSummary(days).then((data) => data.summary),
  });
}

export function useUsageRecords(limit = 100) {
  return useQuery({
    queryKey: queryKeys.usageRecords,
    queryFn: () => api.usageRecords(limit).then((data) => data.records),
  });
}

export function useCredentials() {
  return useQuery({
    queryKey: queryKeys.credentials,
    queryFn: () => api.listCredentials().then((data) => data.credentials),
  });
}

export function useCreateRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.createRun,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['runs'] });
      client.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export function useRunAction(
  action: 'pause' | 'resume' | 'cancel' | 'retry' | 'start',
  options?: UseMutationOptions<unknown, Error, { id: string; restartStage?: boolean }>
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, restartStage }: { id: string; restartStage?: boolean }) => {
      switch (action) {
        case 'pause':
          return api.pauseRun(id);
        case 'resume':
          return api.resumeRun(id);
        case 'cancel':
          return api.cancelRun(id);
        case 'retry':
          return api.retryRun(id, restartStage);
        case 'start':
          return api.startRun(id);
      }
    },
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: queryKeys.run(variables.id) });
      client.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (error) => {
      toast('Action failed', error.message, 'error');
    },
    ...options,
  });
}

export function useApproveRun(runId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ decision, note }: { decision: 'approve' | 'reject'; note?: string }) =>
      api.approveRun(runId, decision, note),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: queryKeys.run(runId) });
      client.invalidateQueries({ queryKey: ['runs'] });
      toast(
        variables.decision === 'approve' ? 'Approved' : 'Changes requested',
        variables.decision === 'approve'
          ? 'The run is continuing.'
          : 'Your note was sent to the agents.',
        'success'
      );
    },
    onError: (error) => toast('Could not resolve approval', error.message, 'error'),
  });
}

export function useSteerRun(runId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.steerRun(runId, content),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.run(runId) });
      toast('Instruction sent', 'Agents will apply it at the next safe point.', 'success');
    },
    onError: (error) => toast('Could not send instruction', error.message, 'error'),
  });
}

export function useAgentMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.agents });

  const create = useMutation({
    mutationFn: (input: {
      name: string;
      role: AgentRole;
      provider: ProviderId;
      model: string;
      systemPrompt: string;
      temperature: number;
      maxTokens: number;
      accent: string;
    }) => api.createAgent(input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateAgent>[1] }) =>
      api.updateAgent(id, input),
    onSuccess: invalidate,
    onMutate: async ({ id, input }) => {
      await client.cancelQueries({ queryKey: queryKeys.agents });
      const previous = client.getQueryData<Agent[]>(queryKeys.agents);
      if (previous) {
        client.setQueryData<Agent[]>(
          queryKeys.agents,
          previous.map((agent) => (agent.id === id ? { ...agent, ...input } : agent))
        );
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) client.setQueryData(queryKeys.agents, context.previous);
      toast('Could not update agent', error.message, 'error');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAgent(id),
    onSuccess: invalidate,
    onError: (error) => toast('Could not delete agent', error.message, 'error'),
  });

  return { create, update, remove };
}

export function useProjectMutations() {
  const client = useQueryClient();
  const invalidate = () => {
    client.invalidateQueries({ queryKey: queryKeys.projects });
    client.invalidateQueries({ queryKey: ['runs'] });
  };
  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.updateProject>[1] }) =>
      api.updateProject(id, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: invalidate,
    onError: (error) => toast('Could not delete project', error.message, 'error'),
  });
  return { create, update, remove };
}

export function useTemplateMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.templates });
  const create = useMutation({
    mutationFn: (input: {
      name: string;
      description: string;
      category: string;
      icon: string;
      objectiveTemplate: string;
      guidance: string;
      suggestedApprovalMode: ApprovalMode;
    }) => api.createTemplate(input),
    onSuccess: invalidate,
    onError: (error) => toast('Could not create template', error.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: invalidate,
    onError: (error) => toast('Could not delete template', error.message, 'error'),
  });
  return { create, remove };
}

export function useCredentialMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.credentials });
  const save = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: ProviderId; apiKey: string }) =>
      api.saveCredential(provider, apiKey),
    onSuccess: invalidate,
  });
  const test = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: ProviderId; apiKey: string }) =>
      api.testCredential(provider, apiKey),
  });
  const remove = useMutation({
    mutationFn: (provider: ProviderId) => api.deleteCredential(provider),
    onSuccess: invalidate,
    onError: (error) => toast('Could not remove key', error.message, 'error'),
  });
  return { save, test, remove };
}
