import type {
  Artifact,
  Run,
  RunAgent,
  RunInstruction,
  RunPlan,
  RunReview,
  WorkflowTemplate,
} from '@nexus/shared';
import { truncate } from '@nexus/shared';
import type { ContextSnapshot } from '../orchestrator/context-manager.js';

const PLANNER_SCHEMA = `{
  "summary": string,              // 1-2 sentences describing the plan
  "approach": string,             // the strategy and why it will work
  "requirements": string[],       // explicit requirements extracted from the objective
  "constraints": string[],        // constraints, assumptions, budget/audience limits
  "deliverables": string[],       // named artifacts the user will receive
  "steps": [{
    "title": string,
    "description": string,        // concrete instructions for the executing agent
    "assigneeRole": "worker" | "reviewer" | "polisher" | "custom",
    "expectedOutput": string,     // the tangible artifact this step creates
    "acceptanceCriteria": string[], // how the reviewer knows this step is complete
    "dependsOn": number[]         // zero-based indexes of prerequisite steps
  }],
  "risks": string[]               // real risks, assumptions, missing information
}`;

const REVIEW_SCHEMA = `{
  "verdict": "approve" | "revise",
  "score": number,                // 0-100
  "summary": string,              // overall assessment
  "strengths": string[],
  "issues": [{
    "severity": "low" | "medium" | "high" | "critical",
    "area": string,
    "description": string,
    "suggestion": string
  }],
  "requiredChanges": string[],     // actionable, only when verdict is "revise"
  "contradictions": string[],      // conflicting claims found between deliverables
  "missingRequirements": string[]  // requirements from the plan that were not met
}`;

const FINAL_DELIVERABLE_SCHEMA = `{
  "title": string,
  "content": string,              // complete final document in Markdown
  "summary": string,              // one-paragraph executive summary
  "sources": string[],            // artifacts or facts this deliverable draws on
  "unresolvedIssues": string[]    // anything the reader should still verify
}`;

function agentRoster(agents: RunAgent[]): string {
  return agents
    .map(
      (agent) =>
        `- ${agent.name} — role: ${agent.role}; model: ${agent.provider}/${agent.model}`
    )
    .join('\n');
}

function instructionBlock(instructions: RunInstruction[]): string {
  if (instructions.length === 0) return '';
  return `\nOPERATOR STEERING INSTRUCTIONS (highest priority):\n${instructions
    .map((instruction) => `- ${instruction.content}`)
    .join('\n')}\n`;
}

function contextBlock(context?: ContextSnapshot | null): string {
  if (!context?.rendered) return '';
  return `\nBOUNDED EXECUTION CONTEXT\n${context.rendered}\n`;
}

export function buildPlannerPrompt(input: {
  run: Run;
  template: WorkflowTemplate | null;
  instructions: RunInstruction[];
  context?: ContextSnapshot | null;
}): { system: string; user: string } {
  const { run, template, instructions, context } = input;
  const planner = run.agents.find((agent) => agent.role === 'planner');
  const roster = agentRoster(run.agents);

  const user = `OBJECTIVE
${run.objective}

PROJECT
${run.projectName ?? 'No project (standalone run)'}

AVAILABLE AGENTS
${roster}

WORKFLOW GUIDANCE
${template?.guidance || 'No template guidance. Use professional judgment.'}

OPERATOR INSTRUCTIONS
${instructions.length > 0 ? instructions.map((i) => `- ${i.content}`).join('\n') : 'None'}
${contextBlock(context)}

CONSTRAINTS
- Produce between 3 and 7 steps.
- Extract the user's explicit requirements and constraints before decomposing work.
- Each step must be assigned to "worker" (execution) or "custom" (a specialist). Use "reviewer" or "polisher" only if the step is specifically an audit or final-edit task.
- Steps must be ordered and dependencies must reference earlier step indexes.
- Give every step measurable acceptanceCriteria the reviewer can check.
- Do not create a step that merely "reviews the plan" or "waits for approval"; the NEXUS engine handles review and approval.
- Every step must produce a concrete artifact.

Respond with ONLY a JSON object matching this schema:
${PLANNER_SCHEMA}`;

  return {
    system: planner?.systemPrompt ?? 'You are Planner, a rigorous planning agent.',
    user,
  };
}

export function buildWorkerPrompt(input: {
  run: Run;
  step: RunPlan['steps'][number];
  stepIndex: number;
  artifacts: Artifact[];
  instructions: RunInstruction[];
  context?: ContextSnapshot | null;
}): { system: string; user: string } {
  const { run, step, stepIndex, artifacts, instructions, context } = input;
  const worker =
    run.agents.find((agent) => agent.role === step.assigneeRole) ??
    run.agents.find((agent) => agent.role === 'worker') ??
    run.agents[0];

  const prior = artifactContext(artifacts, 24_000);
  const dependencies =
    step.dependsOn.length > 0
      ? step.dependsOn
          .map((index) => {
            const dependency = run.plan?.steps[index];
            return dependency ? `- Step ${index + 1}: ${dependency.title}` : null;
          })
          .filter(Boolean)
          .join('\n')
      : 'None';

  const user = `OBJECTIVE
${run.objective}

PLAN SUMMARY
${run.plan?.summary ?? ''}

APPROACH
${run.plan?.approach ?? ''}

REQUIREMENTS
${run.plan?.requirements?.length ? run.plan.requirements.map((item) => `- ${item}`).join('\n') : 'Infer from the objective.'}

CONSTRAINTS
${run.plan?.constraints?.length ? run.plan.constraints.map((item) => `- ${item}`).join('\n') : 'None stated.'}

CURRENT STEP (${stepIndex + 1} of ${run.plan?.steps.length ?? 0})
Title: ${step.title}
Instructions: ${step.description}
Expected output: ${step.expectedOutput}
Acceptance criteria:
${step.acceptanceCriteria?.length ? step.acceptanceCriteria.map((item) => `- ${item}`).join('\n') : '- Meets the expected output completely.'}

DEPENDENCIES
${dependencies}

PRIOR WORK PRODUCTS
${prior || 'No prior artifacts yet. This is the first execution step.'}
${contextBlock(context)}
${instructionBlock(instructions)}

REQUIREMENTS
- Produce the complete deliverable for this step now.
- Use clean Markdown with a title, useful structure, and concrete detail.
- If this step requests code, include complete, runnable code in fenced blocks with the correct language tag.
- Never use placeholders such as "TBD" or "[insert here]". If a fact is unknown, state the assumption.
- Do not describe what you will do. Do the work.`;

  return {
    system: worker?.systemPrompt ?? 'You are a precise execution agent.',
    user,
  };
}

export function buildReviewPrompt(input: {
  run: Run;
  artifacts: Artifact[];
  instructions: RunInstruction[];
  context?: ContextSnapshot | null;
}): { system: string; user: string } {
  const { run, artifacts, instructions, context } = input;
  const reviewer = run.agents.find((agent) => agent.role === 'reviewer');

  const user = `OBJECTIVE
${run.objective}

PLAN
${run.plan?.summary ?? ''}

REQUIREMENTS
${run.plan?.requirements?.length ? run.plan.requirements.map((item) => `- ${item}`).join('\n') : 'Infer from the objective.'}

DELIVERABLES UNDER REVIEW
${artifactContext(artifacts, 36_000)}
${contextBlock(context)}
${instructionBlock(instructions)}

REVIEW REQUIREMENTS
- Judge the deliverables against the objective, the plan requirements, and the expected outputs, not against your own preferred style.
- Check the actual artifacts. Do not assume missing work will appear later.
- Identify contradictions between artifacts and requirements that were not met.
- A score of 80+ is required for approval.
- If the work is not ready to ship, set verdict to "revise" and list concrete requiredChanges.
- Do not request changes that contradict explicit operator instructions.
- Be specific: cite the section or claim that needs work.

Respond with ONLY a JSON object matching this schema:
${REVIEW_SCHEMA}`;

  return {
    system: reviewer?.systemPrompt ?? 'You are Reviewer, a rigorous quality gate.',
    user,
  };
}

export function buildRevisionPrompt(input: {
  run: Run;
  review: RunReview;
  artifacts: Artifact[];
  instructions: RunInstruction[];
  context?: ContextSnapshot | null;
}): { system: string; user: string } {
  const { run, review, artifacts, instructions, context } = input;
  const worker =
    run.agents.find((agent) => agent.role === 'worker') ?? run.agents[0];

  const requiredChanges = review.requiredChanges.length
    ? review.requiredChanges.map((change, index) => `${index + 1}. ${change}`).join('\n')
    : review.issues.map((issue) => `- ${issue.area}: ${issue.suggestion}`).join('\n');

  const user = `OBJECTIVE
${run.objective}

REVIEWER FEEDBACK (round ${review.round})
Verdict: ${review.verdict} — score ${review.score}/100
${review.summary}

REQUIRED CHANGES
${requiredChanges || 'Address the issues identified by the reviewer.'}

CURRENT DELIVERABLES
${artifactContext(artifacts, 30_000)}
${contextBlock(context)}
${instructionBlock(instructions)}

TASK
Produce a revised, complete version of the deliverable that applies every required change. Preserve everything that was already correct. Return the full revised document in clean Markdown — not a diff, not a summary of changes.`;

  return {
    system: worker?.systemPrompt ?? 'You are a precise execution agent.',
    user,
  };
}

export function buildPolisherPrompt(input: {
  run: Run;
  artifacts: Artifact[];
  review: RunReview | null;
  instructions: RunInstruction[];
  context?: ContextSnapshot | null;
}): { system: string; user: string } {
  const { run, artifacts, review, instructions, context } = input;
  const polisher = run.agents.find((agent) => agent.role === 'polisher');

  const user = `OBJECTIVE
${run.objective}

APPROVED MATERIALS
${artifactContext(artifacts, 40_000)}

REVIEW OUTCOME
${review ? `Score ${review.score}/100 — ${review.summary}` : 'No formal review available.'}
${contextBlock(context)}
${instructionBlock(instructions)}

TASK
Create the definitive final deliverable. Merge the materials into one coherent, polished document that directly fulfills the objective.
- Start with a clear title and a one-line purpose statement.
- Preserve all verified facts, figures, code, and decisions.
- Remove repetition, scaffolding, and meta commentary.
- Use clean Markdown, tables where they add clarity, and correct code fences.
- This must be ready to send to a client without further editing.

Respond with ONLY a JSON object matching this schema. The "content" field must contain the complete document in Markdown.
${FINAL_DELIVERABLE_SCHEMA}`;

  return {
    system: polisher?.systemPrompt ?? 'You are the final editor for this deliverable.',
    user,
  };
}

export function artifactContext(artifacts: Artifact[], budget: number): string {
  if (artifacts.length === 0) return '';
  const perArtifact = Math.max(1_500, Math.floor(budget / artifacts.length));
  return artifacts
    .map((artifact) => {
      const header = `### ${artifact.name} (v${artifact.version}${
        artifact.agentName ? `, by ${artifact.agentName}` : ''
      })`;
      return `${header}\n${truncate(artifact.content, perArtifact)}`;
    })
    .join('\n\n---\n\n');
}
