import { useCallback, useEffect, useState } from 'react';
import { cacheDelete, cacheGet, cacheSet } from '@/lib/cache';

/**
 * Keeps a composer draft on-device (SQLite/localStorage) so leaving a screen
 * never loses the user's words. Writes are debounced while typing.
 */
export function usePersistentDraft(key: string, initial = '') {
  const [value, setValue] = useState(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    void cacheGet(key).then((stored) => {
      if (!active) return;
      if (stored) setValue(stored);
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      if (value.trim().length === 0) {
        void cacheDelete(key);
      } else {
        void cacheSet(key, value);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [hydrated, key, value]);

  const clear = useCallback(async () => {
    setValue('');
    await cacheDelete(key);
  }, [key]);

  return { value, setValue, hydrated, clear };
}

export function useRunDraftKey(runId: string | string[] | undefined): string {
  const id = Array.isArray(runId) ? runId[0] : runId;
  return `nexus.draft.workspace.${id ?? 'unknown'}`;
}
