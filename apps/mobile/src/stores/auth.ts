import { create } from 'zustand';
import type { AuthSession } from '@nexus/shared';
import { api, ApiError, configureApi } from '@/lib/api';
import { DEFAULT_API_URL, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/config';
import { cacheGet, cacheSet } from '@/lib/cache';
import { deleteSecret, getSecret, setSecret } from '@/lib/secure-storage';

const SESSION_KEY = 'nexus.session';
const API_URL_KEY = 'nexus.apiUrl';

interface SettingsState {
  apiUrl: string;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setApiUrl: (url: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiUrl: DEFAULT_API_URL,
  hydrated: false,
  hydrate: async () => {
    const stored = await cacheGet(API_URL_KEY);
    const apiUrl = stored?.trim() || DEFAULT_API_URL;
    configureApi({ baseUrl: apiUrl });
    set({ apiUrl, hydrated: true });
  },
  setApiUrl: async (url: string) => {
    const apiUrl = url.trim().replace(/\/+$/, '');
    configureApi({ baseUrl: apiUrl });
    await cacheSet(API_URL_KEY, apiUrl);
    set({ apiUrl });
  },
}));

interface AuthState {
  session: AuthSession | null;
  hydrated: boolean;
  busy: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  signInDev: (input: { email: string; name?: string }) => Promise<void>;
  signInSupabase: (input: { email: string; password: string }) => Promise<void>;
  refresh: () => Promise<boolean>;
  signOut: () => Promise<void>;
  setError: (message: string | null) => void;
}

async function supabaseRequest(path: string, body: unknown): Promise<any> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new ApiError({
      code: 'SUPABASE_NOT_CONFIGURED',
      status: 0,
      message:
        'Supabase is not configured in this build. Use local workspace sign-in instead.',
    });
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new ApiError({
      code: parsed?.error_code ?? 'SUPABASE_AUTH_FAILED',
      status: response.status,
      message:
        parsed?.msg ??
        parsed?.error_description ??
        'Supabase rejected those credentials. Check your email and password.',
    });
  }
  return parsed;
}

function toSupabaseSession(payload: any): AuthSession {
  const user = payload.user;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1_000 : null,
    mode: 'supabase',
    user: {
      id: String(user?.id ?? ''),
      email: String(user?.email ?? ''),
      name:
        (user?.user_metadata?.name as string | undefined) ??
        (user?.user_metadata?.full_name as string | undefined) ??
        null,
      createdAt: String(user?.created_at ?? new Date().toISOString()),
    },
  };
}

async function persistSession(session: AuthSession | null): Promise<void> {
  configureApi({ token: session?.accessToken ?? null });
  if (session) {
    await setSecret(SESSION_KEY, JSON.stringify(session));
  } else {
    await deleteSecret(SESSION_KEY);
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  hydrated: false,
  busy: false,
  error: null,

  hydrate: async () => {
    try {
      const raw = await getSecret(SESSION_KEY);
      if (!raw) {
        set({ hydrated: true });
        return;
      }
      const session = JSON.parse(raw) as AuthSession;
      if (session.expiresAt && session.expiresAt < Date.now()) {
        if (session.refreshToken && session.mode === 'supabase') {
          configureApi({ token: session.accessToken });
          const refreshed = await get().refresh();
          if (!refreshed) {
            await persistSession(null);
            set({ session: null, hydrated: true });
            return;
          }
        } else {
          await persistSession(null);
          set({ session: null, hydrated: true });
          return;
        }
      }
      configureApi({ token: session.accessToken });
      set({ session, hydrated: true });
    } catch {
      await persistSession(null);
      set({ hydrated: true });
    }
  },

  signInDev: async (input) => {
    set({ busy: true, error: null });
    try {
      const session = await api.devSignIn(input);
      await persistSession(session);
      set({ session, busy: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Sign-in failed. Try again.';
      set({ busy: false, error: message });
      throw error;
    }
  },

  signInSupabase: async (input) => {
    set({ busy: true, error: null });
    try {
      const payload = await supabaseRequest('token?grant_type=password', {
        email: input.email,
        password: input.password,
      });
      const session = toSupabaseSession(payload);
      await persistSession(session);
      set({ session, busy: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Sign-in failed. Try again.';
      set({ busy: false, error: message });
      throw error;
    }
  },

  refresh: async () => {
    const session = get().session;
    if (!session?.refreshToken) return false;
    try {
      const payload = await supabaseRequest('token?grant_type=refresh_token', {
        refresh_token: session.refreshToken,
      });
      const next = toSupabaseSession(payload);
      await persistSession(next);
      set({ session: next });
      return true;
    } catch {
      return false;
    }
  },

  signOut: async () => {
    await persistSession(null);
    set({ session: null, error: null });
  },

  setError: (message) => set({ error: message }),
}));
