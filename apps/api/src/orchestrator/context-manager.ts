import type {
  Artifact,
  PlanStep,
  Run,
  RunEvent,
  RunInstruction,
} from '@nexus/shared';
import { truncate } from '@nexus/shared';
import { Errors } from '../errors.js';
import type { OrchestratorStore } from './store.js';

export interface ContextRequest {
  run: Run;
  task: string;
  step?: PlanStep | null;
  review?: string | null;
  budgetChars?: number;
  artifactBudgetChars?: number;
  historyBudgetChars?: number;
  maxArtifacts?: number;
  maxHistory?: number;
}

export interface ContextSnapshot {
  runId: string;
  userId: string;
  projectId: string | null;
  objective: string;
  task: string;
  summary: string;
  requirements: string[];
  constraints: string[];
  artifacts: Artifact[];
  instructions: RunInstruction[];
  history: RunEvent[];
  rendered: string;
  truncated: boolean;
}

/**
 * Assembles the bounded context handed to an agent. Every read is scoped to
 * the run's owner and project, so one user's project can never leak material
 * into another user's execution.
 */
export class ContextManager {
  constructor(private readonly store: OrchestratorStore) {}

  assertIsolation(run: Run, userId: string, projectId: string | null): void {
    if (run.userId !== userId) {
      throw Errors.forbidden('This execution context belongs to another user.');
    }
    if ((run.projectId ?? null) !== (projectId ?? null)) {
      throw Errors.forbidden('This execution context belongs to another project.');
    }
  }

  async build(request: ContextRequest): Promise<ContextSnapshot> {
    const { run } = request;
    if (!run.userId) throw Errors.forbidden('Execution context has no owner.');

    const budget = request.budgetChars ?? 48_000;
    const artifactBudget = request.artifactBudgetChars ?? 28_000;
    const historyBudget = request.historyBudgetChars ?? 6_000;

    const [allArtifacts, allInstructions, allHistory] = await Promise.all([
      this.store.listArtifacts(run.id),
      this.store.listUnconsumedInstructions(run.id),
      this.store.listEvents(run.id, 0, 200),
    ]);

    // Defense in depth: the store is already run-scoped, but never trust a
    // repository join when the agent context is assembled.
    const artifacts = allArtifacts
      .filter((artifact) => artifact.runId === run.id && artifact.userId === run.userId)
      .slice(-(request.maxArtifacts ?? 14));
    const instructions = allInstructions.filter(
      (instruction) => instruction.runId === run.id && !instruction.consumed
    );
    const history = allHistory
      .filter((event) => event.runId === run.id && event.type !== 'agent.token')
      .slice(-(request.maxHistory ?? 30));

    const artifactText = this.renderArtifacts(artifacts, artifactBudget);
    const instructionText = instructions
      .map((instruction) => `- ${instruction.content}`)
      .join('\n');
    const historyText = truncate(
      history
        .map((event) => `- ${event.createdAt} ${event.type}`)
        .join('\n'),
      historyBudget
    );

    const stepText = request.step
      ? [
          `CURRENT TASK: ${request.step.title}`,
          `Instructions: ${request.step.description}`,
          `Expected output: ${request.step.expectedOutput}`,
          request.step.acceptanceCriteria?.length
            ? `Acceptance criteria:\n${request.step.acceptanceCriteria
                .map((criterion) => `- ${criterion}`)
                .join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : `CURRENT TASK: ${request.task}`;

    const sections = [
      `OBJECTIVE\n${run.objective}`,
      `PROJECT\n${run.projectName ?? 'No project (standalone run)'}`,
      stepText,
      run.plan
        ? `PLAN SUMMARY\n${run.plan.summary}\n\nAPPROACH\n${run.plan.approach}`
        : '',
      run.plan?.requirements?.length
        ? `REQUIREMENTS\n${run.plan.requirements.map((item) => `- ${item}`).join('\n')}`
        : '',
      run.plan?.constraints?.length
        ? `CONSTRAINTS\n${run.plan.constraints.map((item) => `- ${item}`).join('\n')}`
        : '',
      request.review ? `LATEST REVIEW FEEDBACK\n${request.review}` : '',
      instructionText ? `OPERATOR INSTRUCTIONS (highest priority)\n${instructionText}` : '',
      artifactText ? `PRIOR OUTPUTS\n${artifactText}` : '',
      historyText ? `EXECUTION HISTORY\n${historyText}` : '',
    ].filter(Boolean);

    const full = sections.join('\n\n');
    const rendered = truncate(full, budget);

    return {
      runId: run.id,
      userId: run.userId,
      projectId: run.projectId,
      objective: run.objective,
      task: request.task,
      summary: truncate(
        [
          run.objective,
          stepText,
          run.plan?.summary ?? '',
          request.review ?? '',
        ]
          .filter(Boolean)
          .join('\n'),
        1_800
      ),
      requirements: run.plan?.requirements ?? [],
      constraints: run.plan?.constraints ?? [],
      artifacts,
      instructions,
      history,
      rendered,
      truncated: rendered.length < full.length,
    };
  }

  private renderArtifacts(artifacts: Artifact[], budget: number): string {
    if (artifacts.length === 0) return '';
    const perArtifact = Math.max(1_200, Math.floor(budget / artifacts.length));
    return artifacts
      .map((artifact) => {
        const header = `### ${artifact.name} (v${artifact.version}${
          artifact.agentName ? `, by ${artifact.agentName}` : ''
        })`;
        return `${header}\n${truncate(artifact.content, perArtifact)}`;
      })
      .join('\n\n---\n\n');
  }
}
