import { accentThemes, type AccentThemeId } from './tokens';
import { usePreferencesStore } from '@/stores/preferences';

export interface AccentTheme {
  id: AccentThemeId;
  label: string;
  accent: string;
  accentBright: string;
  surface: string;
  border: string;
  onAccent: string;
}

export function useAccent(): AccentTheme {
  const id = usePreferencesStore((state) => state.accent);
  return { id, ...accentThemes[id] };
}

export function useReduceMotion(): boolean {
  return usePreferencesStore((state) => state.reduceMotion);
}

export function useHapticsEnabled(): boolean {
  return usePreferencesStore((state) => state.haptics);
}
