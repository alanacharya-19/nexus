/**
 * Backwards-compatible import surface. The event bus and live registry now
 * live in the orchestrator module so both the legacy engine and the new
 * execution pipeline share exactly one fan-out path.
 */
export {
  eventBus,
  liveRegistry,
  ExecutionEventEmitter,
  RunEventBus,
  LiveRegistry,
} from '../orchestrator/event-emitter.js';
