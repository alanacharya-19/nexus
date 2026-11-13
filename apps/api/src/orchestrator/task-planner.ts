import type {
  AgentRole,
  ExecutionPlan,
  PlanStep,
  Run,
  RunAgent,
  RunPlan,
} from '@nexus/shared';
import type { PlannerOutput } from '@nexus/shared';
import { plannerOutputSchema } from '@nexus/shared';
import { Errors } from '../errors.js';
import { buildPlannerPrompt } from '../orchestration/prompts.js';
import { AgentRunner, type AgentRunResult } from './agent-runner.js';
import type { ContextManager } from './context-manager.js';
import type { OrchestratorStore } from './store.js';

export interface PlanRequest {
  run: Run;
  signal: AbortSignal;
}

export interface PlanResult {
  plan: ExecutionPlan;
  runPlan: RunPlan;
  agent: RunAgent;
  result: AgentRunResult<PlannerOutput>;
}

/**
 * Turns the user objective into a Zod-validated, dependency-checked execution
 * plan. The model never decides how many steps the engine will run: steps are
 * clamped, dependencies are filtered, and every step is bound to a frozen agent
 * from the run roster before execution starts.
 */
export class TaskPlanner {
  constructor(
    private readonly store: OrchestratorStore,
    private readonly context: ContextManager,
    private readonly runner: AgentRunner
  ) {}

  async createPlan(request: PlanRequest): Promise<PlanResult> {
    const { run, signal } = request;
    const agent = run.agents.find((candidate) => candidate.role === 'planner');
    if (!agent) throw Errors.invalidState('This run has no planner agent configured.');

    const template = run.templateId
      ? await this.store.getTemplate(run.userId, run.templateId)
      : null;

    const context = await this.context.build({
      run,
      task: 'Decompose the objective into executable worker subtasks.',
      budgetChars: 30_000,
      artifactBudgetChars: 12_000,
    });

    const prompt = buildPlannerPrompt({
      run,
      template,
      instructions: context.instructions,
      context,
    });

    const result = await this.runner.run<PlannerOutput>({
      run,
      agent,
      kind: 'plan',
      stage: 'plan',
      task: 'Create the execution plan',
      prompt,
      signal,
      schema: plannerOutputSchema,
    });

    if (!result.structured) {
      throw Errors.aiInvalidOutput('The planner did not return structured output.');
    }

    const plan = this.toExecutionPlan(run, result.structured);
    const runPlan = this.toRunPlan(plan);
    return { plan, runPlan, agent, result };
  }

  toExecutionPlan(run: Run, output: PlannerOutput): ExecutionPlan {
    const steps: PlanStep[] = output.steps.map((step, index) => {
      const assigned = this.resolveAgent(run, step.assigneeRole);
      const dependsOn = Array.from(
        new Set(
          step.dependsOn.filter(
            (dependency) => Number.isInteger(dependency) && dependency >= 0 && dependency < index
          )
        )
      );
      const acceptanceCriteria =
        step.acceptanceCriteria.length > 0
          ? step.acceptanceCriteria
          : [
              `Produces ${step.expectedOutput}`,
              'Directly supports the stated objective without placeholders.',
            ];

      return {
        id: `step_${index + 1}`,
        title: step.title,
        description: step.description,
        assigneeRole: step.assigneeRole,
        assignedAgentId: assigned?.agentId ?? null,
        expectedOutput: step.expectedOutput,
        acceptanceCriteria,
        dependsOn,
        status: 'pending',
        attempts: 0,
        outputArtifactId: null,
      };
    });

    if (steps.length === 0) {
      throw Errors.aiInvalidOutput('The planner returned a plan without steps.');
    }

    return {
      summary: output.summary,
      approach: output.approach,
      requirements: output.requirements,
      constraints: output.constraints,
      deliverables: output.deliverables,
      steps,
      risks: output.risks,
      createdAt: new Date().toISOString(),
    };
  }

  toRunPlan(plan: ExecutionPlan): RunPlan {
    return {
      summary: plan.summary,
      approach: plan.approach,
      requirements: plan.requirements,
      constraints: plan.constraints,
      deliverables: plan.deliverables,
      steps: plan.steps,
      risks: plan.risks,
      createdAt: plan.createdAt,
    };
  }

  private resolveAgent(run: Run, role: AgentRole): RunAgent | null {
    return (
      run.agents.find((agent) => agent.role === role) ??
      run.agents.find((agent) => agent.role === 'worker') ??
      run.agents[0] ??
      null
    );
  }
}
