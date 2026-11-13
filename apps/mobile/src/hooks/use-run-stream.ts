import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LiveAgentOutput, RunEvent, StreamMessage } from '@nexus/shared';
import { api, ApiError, streamUrl } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const REFRESH_EVENTS = new Set([
  'run.status',
  'run.stage',
  'run.paused',
  'run.resumed',
  'run.retried',
  'execution.started',
  'execution.state',
  'execution.completed',
  'execution.failed',
  'plan.created',
  'step.updated',
  'agent.activated',
  'agent.status',
  'agent.output',
  'review.started',
  'review.completed',
  'revision.requested',
  'artifact.created',
  'approval.requested',
  'approval.resolved',
  'approval.granted',
  'agent.fallback',
  'run.completed',
  'run.failed',
]);

interface UseRunStreamOptions {
  initialEvents: RunEvent[];
  initialLive: LiveAgentOutput | null;
  enabled?: boolean;
}

export function useRunStream(
  runId: string,
  { initialEvents, initialLive, enabled = true }: UseRunStreamOptions
) {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<RunEvent[]>(initialEvents);
  const [live, setLive] = useState<LiveAgentOutput | null>(initialLive);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastSeq = useRef(
    initialEvents.reduce((max, event) => Math.max(max, event.seq), 0)
  );
  const liveRef = useRef<LiveAgentOutput | null>(initialLive);
  const pendingText = useRef('');
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const stoppedRef = useRef(false);

  // Merge replayed/refetched events without duplicating or reordering.
  useEffect(() => {
    if (initialEvents.length > 0) {
      lastSeq.current = Math.max(
        lastSeq.current,
        initialEvents.reduce((max, event) => Math.max(max, event.seq), 0)
      );
    }
    if (initialLive && !liveRef.current) {
      liveRef.current = initialLive;
    }
  }, [initialEvents, initialLive]);

  const pushLiveText = useCallback((delta: string) => {
    if (!liveRef.current) return;
    pendingText.current += delta;
    if (flushTimer.current) return;
    flushTimer.current = setInterval(() => {
      if (pendingText.current && liveRef.current) {
        const text = pendingText.current;
        pendingText.current = '';
        liveRef.current = { ...liveRef.current, text: liveRef.current.text + text };
        setLive(liveRef.current);
      } else if (!pendingText.current && flushTimer.current) {
        clearInterval(flushTimer.current);
        flushTimer.current = null;
      }
    }, 55);
  }, []);

  const handleEvent = useCallback(
    (event: RunEvent) => {
      if (event.seq > 0) {
        if (event.seq <= lastSeq.current) return;
        lastSeq.current = event.seq;
      }

      if (event.type === 'agent.token') {
        const payload = event.payload as { agentId: string; delta: string };
        if (liveRef.current && liveRef.current.agentId === payload.agentId) {
          pushLiveText(payload.delta);
        } else if (!liveRef.current) {
          liveRef.current = {
            runId: event.runId,
            agentId: payload.agentId,
            agentName: 'Agent',
            stage: 'work',
            text: payload.delta,
            startedAt: event.createdAt,
          };
          setLive(liveRef.current);
        }
        return;
      }

      setEvents((current) => mergeEvents(current, [event]));

      if (event.type === 'agent.started') {
        const payload = event.payload as {
          agentId: string;
          agentName: string;
          stage: LiveAgentOutput['stage'];
        };
        pendingText.current = '';
        liveRef.current = {
          runId: event.runId,
          agentId: payload.agentId,
          agentName: payload.agentName,
          stage: payload.stage,
          text: '',
          startedAt: event.createdAt,
        };
        setLive(liveRef.current);
      }

      if (event.type === 'agent.completed' || event.type === 'agent.fallback') {
        if (event.type === 'agent.completed') {
          pendingText.current = '';
          if (flushTimer.current) {
            clearInterval(flushTimer.current);
            flushTimer.current = null;
          }
        }
      }

      if (REFRESH_EVENTS.has(event.type)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) });
      }
      if (event.type === 'run.status') {
        const payload = event.payload as { status: string };
        if (payload.status === 'running' || payload.status === 'completed') {
          queryClient.invalidateQueries({ queryKey: ['runs'] });
        }
        if (TERMINAL_STATUSES.has(payload.status)) {
          queryClient.invalidateQueries({ queryKey: ['runs'] });
          queryClient.invalidateQueries({ queryKey: ['artifacts'] });
          queryClient.invalidateQueries({ queryKey: ['usage'] });
          stoppedRef.current = true;
          setConnected(false);
          xhrRef.current?.abort();
        }
      }
      if (event.type === 'execution.state') {
        const payload = event.payload as { status: string };
        if (TERMINAL_STATUSES.has(payload.status)) {
          queryClient.invalidateQueries({ queryKey: ['artifacts'] });
          stoppedRef.current = true;
          setConnected(false);
          xhrRef.current?.abort();
        }
      }
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'execution.completed' ||
        event.type === 'execution.failed'
      ) {
        queryClient.invalidateQueries({ queryKey: ['runs'] });
        queryClient.invalidateQueries({ queryKey: ['artifacts'] });
        queryClient.invalidateQueries({ queryKey: ['usage'] });
      }
    },
    [pushLiveText, queryClient, runId]
  );

  const connectRef = useRef<() => void>(() => {});

  const scheduleRetry = useCallback(() => {
    if (stoppedRef.current || !enabled) return;
    if (retryRef.current) clearTimeout(retryRef.current);
    attemptRef.current += 1;
    setReconnecting(true);
    const delay = Math.min(10_000, 900 * 2 ** (attemptRef.current - 1));
    retryRef.current = setTimeout(() => {
      retryRef.current = null;
      connectRef.current();
    }, delay);
  }, [enabled]);

  const connect = useCallback(async () => {
    if (stoppedRef.current || !enabled) return;
    setReconnecting(attemptRef.current > 0);
    setError(null);

    let token: string;
    try {
      const result = await api.streamToken(runId);
      token = result.token;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Your session expired. Sign in again to continue watching this run.');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Could not open the live stream.');
      scheduleRetry();
      return;
    }

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('GET', streamUrl(runId, token, lastSeq.current));
    xhr.setRequestHeader('accept', 'text/event-stream');

    let cursor = 0;
    let buffer = '';

    const processBlock = (block: string) => {
      let eventName = 'message';
      const dataLines: string[] = [];
      for (const rawLine of block.split(/\r?\n/)) {
        if (!rawLine || rawLine.startsWith(':')) continue;
        const separator = rawLine.indexOf(':');
        const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
        let value = separator === -1 ? '' : rawLine.slice(separator + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') eventName = value;
        if (field === 'data') dataLines.push(value);
      }
      if (dataLines.length === 0) return;
      const raw = dataLines.join('\n');

      if (eventName === 'stream.heartbeat') return;
      if (eventName === 'stream.ready') {
        try {
          const message = JSON.parse(raw) as StreamMessage;
          if (message.event === 'stream.ready' && message.data.live) {
            liveRef.current = message.data.live;
            setLive(message.data.live);
          }
        } catch {
          // Ignore malformed ready frames.
        }
        return;
      }
      if (eventName === 'stream.error') {
        try {
          const message = JSON.parse(raw) as StreamMessage;
          if (message.event === 'stream.error') setError(message.data.message);
        } catch {
          setError('The live stream reported an error.');
        }
        return;
      }
      if (eventName !== 'run.event') return;

      try {
        const event = JSON.parse(raw) as RunEvent;
        handleEvent(event);
      } catch {
        // Ignore malformed event frames; the next replay will resync.
      }
    };

    xhr.onprogress = () => {
      const text = xhr.responseText;
      const next = text.slice(cursor);
      cursor = text.length;
      buffer += next;
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processBlock(block);
        boundary = buffer.indexOf('\n\n');
      }
    };

    xhr.onerror = () => {
      setConnected(false);
      if (stoppedRef.current) return;
      setError('The live connection dropped. Reconnecting…');
      scheduleRetry();
    };

    xhr.onload = () => {
      setConnected(false);
      if (stoppedRef.current) return;
      if (xhr.status === 401 || xhr.status === 403) {
        setError('Your session expired. Sign in again to continue watching this run.');
        return;
      }
      if (xhr.status >= 400) {
        setError('The live stream could not be opened. Retrying…');
        scheduleRetry();
        return;
      }
      // A clean close usually means the run finished. Refresh once more.
      queryClient.invalidateQueries({ queryKey: queryKeys.run(runId) });
      if (attemptRef.current < 4) scheduleRetry();
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2 && xhr.status === 200) {
        setConnected(true);
        setReconnecting(false);
        setError(null);
        attemptRef.current = 0;
      }
    };

    xhr.send();
  }, [enabled, handleEvent, queryClient, runId, scheduleRetry]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    stoppedRef.current = false;
    attemptRef.current = 0;
    void connect();
    return () => {
      stoppedRef.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (flushTimer.current) clearInterval(flushTimer.current);
      xhrRef.current?.abort();
      xhrRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, enabled]);

  const mergedEvents = useMemo(
    () => mergeEvents(events, initialEvents),
    [events, initialEvents]
  );

  return {
    events: mergedEvents,
    live: live ?? initialLive,
    connected,
    reconnecting,
    error,
  };
}

function mergeEvents(current: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  if (incoming.length === 0) return current;
  const byId = new Map<string, RunEvent>();
  for (const event of current) byId.set(`${event.seq}:${event.id}`, event);
  for (const event of incoming) byId.set(`${event.seq}:${event.id}`, event);
  const merged = Array.from(byId.values());
  merged.sort((a, b) => {
    if (a.seq === b.seq) return a.id - b.id;
    return a.seq - b.seq;
  });
  return merged;
}
