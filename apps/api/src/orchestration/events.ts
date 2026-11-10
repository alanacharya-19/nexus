import type { LiveAgentOutput, RunEvent, RunStage } from '@nexus/shared';

type Listener = (event: RunEvent) => void;

/**
 * In-process fan-out for run events. Tokens are ephemeral and only travel over
 * this bus; durable state transitions are persisted first and then published.
 */
class RunEventBus {
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

  publishToken(
    runId: string,
    agentId: string,
    delta: string
  ): void {
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

class LiveRegistry {
  private outputs = new Map<string, LiveAgentOutput>();
  private maxChars = 120_000;

  start(input: Omit<LiveAgentOutput, 'text' | 'startedAt'>): void {
    this.outputs.set(input.runId, {
      ...input,
      text: '',
      startedAt: new Date().toISOString(),
    });
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
