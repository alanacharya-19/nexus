import type {
  AgentExecutionStatus,
  LiveAgentOutput,
  RunEvent,
  RunEventPayloads,
  RunEventType,
  RunStage,
} from '@nexus/shared';
import type { OrchestratorStore } from './store.js';

type Listener = (event: RunEvent) => void;

/** In-process fan-out for persisted run events and ephemeral tokens. */
export class RunEventBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(runId: string, listener: Listener): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.listeners.delete(runId);
    };
  }

  publish(event: RunEvent): void {
    const set = this.listeners.get(event.runId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not break orchestration.
      }
    }
  }

  publishToken(runId: string, agentId: string, delta: string): void {
    this.publish({
      id: 0,
      runId,
      seq: 0,
      type: 'agent.token',
      agentId,
      payload: { agentId, delta },
      createdAt: new Date().toISOString(),
    });
  }
}

export class LiveRegistry {
  private outputs = new Map<string, LiveAgentOutput>();
  private maxChars = 120_000;

  start(input: Omit<LiveAgentOutput, 'text' | 'startedAt'>): void {
    this.outputs.set(input.runId, {
      ...input,
      status: input.status ?? 'working',
      text: '',
      startedAt: new Date().toISOString(),
    });
  }

  setStatus(runId: string, status: AgentExecutionStatus): void {
    const live = this.outputs.get(runId);
    if (live) live.status = status;
  }

  append(runId: string, agentId: string, delta: string): void {
    const live = this.outputs.get(runId);
    if (!live || live.agentId !== agentId) return;
    const next = live.text + delta;
    live.text = next.length > this.maxChars ? next.slice(-this.maxChars) : next;
  }

  get(runId: string): LiveAgentOutput | null {
    return this.outputs.get(runId) ?? null;
  }

  clear(runId: string): void {
    this.outputs.delete(runId);
  }

  setStage(runId: string, stage: RunStage): void {
    const live = this.outputs.get(runId);
    if (live) live.stage = stage;
  }
}

export const eventBus = new RunEventBus();
export const liveRegistry = new LiveRegistry();

/**
 * Persists a durable event before publishing it. `key` makes emission
 * idempotent: replaying a checkpoint cannot duplicate a timeline entry.
 */
export class ExecutionEventEmitter {
  constructor(
    private readonly store: OrchestratorStore,
    private readonly bus: RunEventBus = eventBus,
    private readonly live: LiveRegistry = liveRegistry
  ) {}

  async emit<K extends RunEventType>(
    runId: string,
    type: K,
    payload: RunEventPayloads[K],
    options: { agentId?: string | null; key?: string | null } = {}
  ): Promise<RunEvent> {
    const event = await this.store.appendEvent(
      runId,
      type,
      payload,
      options.agentId ?? null,
      options.key ?? null
    );
    this.bus.publish(event);
    return event;
  }

  startLive(input: Omit<LiveAgentOutput, 'text' | 'startedAt'>): void {
    this.live.start(input);
  }

  appendLive(runId: string, agentId: string, delta: string): void {
    this.live.append(runId, agentId, delta);
  }

  setLiveStatus(runId: string, status: AgentExecutionStatus): void {
    this.live.setStatus(runId, status);
  }

  clearLive(runId: string): void {
    this.live.clear(runId);
  }

  getLive(runId: string): LiveAgentOutput | null {
    return this.live.get(runId);
  }

  publishToken(runId: string, agentId: string, delta: string): void {
    this.bus.publishToken(runId, agentId, delta);
  }
}
