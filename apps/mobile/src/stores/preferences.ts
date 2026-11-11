import { create } from 'zustand';
import type { AccentThemeId } from '@/theme/tokens';
import { accentThemes } from '@/theme/tokens';
import { cacheGet, cacheSet } from '@/lib/cache';

/**
 * Local-only interface preferences. Nothing here is sent to the server.
 * The store hydrates once at boot and persists every mutation through the
 * cross-platform cache (SQLite on device, localStorage on web).
 */

const PREFERENCES_KEY = 'nexus.preferences';

export interface NotificationPreferences {
  runCompleted: boolean;
  approvalNeeded: boolean;
  runFailed: boolean;
  dailyDigest: boolean;
}

export interface Preferences {
  accent: AccentThemeId;
  haptics: boolean;
  reduceMotion: boolean;
  compactLists: boolean;
  notifications: NotificationPreferences;
}

export const DEFAULT_PREFERENCES: Preferences = {
  accent: 'electric',
  haptics: true,
  reduceMotion: false,
  compactLists: false,
  notifications: {
    runCompleted: true,
    approvalNeeded: true,
    runFailed: true,
    dailyDigest: false,
  },
};

interface PreferencesState extends Preferences {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setAccent: (accent: AccentThemeId) => void;
  setHaptics: (enabled: boolean) => void;
  setReduceMotion: (enabled: boolean) => void;
  setCompactLists: (enabled: boolean) => void;
  setNotification: (key: keyof NotificationPreferences, value: boolean) => void;
}

function sanitize(raw: unknown): Preferences {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFERENCES;
  const value = raw as Partial<Preferences>;
  return {
    accent:
      value.accent && value.accent in accentThemes
        ? (value.accent as AccentThemeId)
        : DEFAULT_PREFERENCES.accent,
    haptics: typeof value.haptics === 'boolean' ? value.haptics : DEFAULT_PREFERENCES.haptics,
    reduceMotion:
      typeof value.reduceMotion === 'boolean'
        ? value.reduceMotion
        : DEFAULT_PREFERENCES.reduceMotion,
    compactLists:
      typeof value.compactLists === 'boolean'
        ? value.compactLists
        : DEFAULT_PREFERENCES.compactLists,
    notifications: {
      ...DEFAULT_PREFERENCES.notifications,
      ...(value.notifications ?? {}),
    },
  };
}

async function persist(state: Preferences): Promise<void> {
  await cacheSet(
    PREFERENCES_KEY,
    JSON.stringify({
      accent: state.accent,
      haptics: state.haptics,
      reduceMotion: state.reduceMotion,
      compactLists: state.compactLists,
      notifications: state.notifications,
    })
  );
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...DEFAULT_PREFERENCES,
  hydrated: false,
  hydrate: async () => {
    const raw = await cacheGet(PREFERENCES_KEY);
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    set({ ...sanitize(parsed), hydrated: true });
  },
  setAccent: (accent) => {
    set({ accent });
    void persist({ ...get(), accent });
  },
  setHaptics: (haptics) => {
    set({ haptics });
    void persist({ ...get(), haptics });
  },
  setReduceMotion: (reduceMotion) => {
    set({ reduceMotion });
    void persist({ ...get(), reduceMotion });
  },
  setCompactLists: (compactLists) => {
    set({ compactLists });
    void persist({ ...get(), compactLists });
  },
  setNotification: (key, value) => {
    const notifications = { ...get().notifications, [key]: value };
    set({ notifications });
    void persist({ ...get(), notifications });
  },
}));
