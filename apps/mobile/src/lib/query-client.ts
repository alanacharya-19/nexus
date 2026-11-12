import { QueryClient } from '@tanstack/react-query';
import type { Persister } from '@tanstack/react-query-persist-client';
import { ApiError } from '@/lib/api';
import { cacheDelete, cacheGet, cacheSet } from '@/lib/cache';
import { APP_VERSION } from '@/lib/config';

const CACHE_KEY = 'query-cache';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      gcTime: 24 * 60 * 60 * 1_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.status >= 400 && error.status < 500) return false;
        }
        return failureCount < 2;
      },
      networkMode: 'offlineFirst',
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
      networkMode: 'online',
    },
  },
});

export const queryPersister: Persister = {
  persistClient: async (client) => {
    await cacheSet(CACHE_KEY, JSON.stringify(client));
  },
  restoreClient: async () => {
    const raw = await cacheGet(CACHE_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  },
  removeClient: async () => {
    await cacheDelete(CACHE_KEY);
  },
};

export const persistOptions = {
  persister: queryPersister,
  maxAge: 24 * 60 * 60 * 1_000,
  buster: `nexus-${APP_VERSION}`,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { state: { status: string } }) =>
      query.state.status === 'success',
  },
};

export const queryKeys = {
  agents: ['agents'] as const,
  projects: ['projects'] as const,
  templates: ['templates'] as const,
  runs: (filter: string) => ['runs', filter] as const,
  run: (id: string) => ['run', id] as const,
  conversations: (filter = '') => ['conversations', filter] as const,
  conversation: (id: string) => ['conversation', id] as const,
  aiPreferences: ['preferences', 'ai'] as const,
  artifacts: ['artifacts'] as const,
  artifact: (id: string) => ['artifact', id] as const,
  usage: (days: number) => ['usage', days] as const,
  usageRecords: ['usage', 'records'] as const,
  credentials: ['credentials'] as const,
};
