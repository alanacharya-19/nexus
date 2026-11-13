/**
 * Production wiring for the multi-agent engine. The public `engine` object is
 * the execution manager; route and service imports stay unchanged while the
 * implementation lives in the orchestrator modules.
 */
import { AgentRunner, defaultProviderResolver } from '../orchestrator/agent-runner.js';
import { ApprovalManager } from '../orchestrator/approval-manager.js';
import { CancellationManager } from '../orchestrator/cancellation-manager.js';
import { ContextManager } from '../orchestrator/context-manager.js';
import { ExecutionEventEmitter } from '../orchestrator/event-emitter.js';
import { ExecutionManager } from '../orchestrator/execution-manager.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { RetryManager } from '../orchestrator/retry-manager.js';
import { StateManager } from '../orchestrator/state-manager.js';
import { postgresStore } from '../orchestrator/store.js';
import { TaskPlanner } from '../orchestrator/task-planner.js';

export function createExecutionManager(
  store = postgresStore,
  resolver = defaultProviderResolver
): ExecutionManager {
  const events = new ExecutionEventEmitter(store);
  const states = new StateManager(store, events);
  const cancellation = new CancellationManager();
  const context = new ContextManager(store);
  const runner = new AgentRunner(store, events, resolver);
  const planner = new TaskPlanner(store, context, runner);
  const approvals = new ApprovalManager(store, events, states);
  const retry = new RetryManager();
  const orchestrator = new Orchestrator({
    store,
    events,
    states,
    approvals,
    planner,
    runner,
    context,
    retry,
    cancellation,
  });

  return new ExecutionManager({
    store,
    events,
    states,
    approvals,
    orchestrator,
    cancellation,
  });
}

export const engine = createExecutionManager();
export { ExecutionManager as OrchestrationEngine } from '../orchestrator/execution-manager.js';
