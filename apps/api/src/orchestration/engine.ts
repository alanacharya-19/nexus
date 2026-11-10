import type {
  ArtifactKind,
  PlanStep,
  ProviderId,
  Run,
  RunAgent,
  RunEvent,
  RunEventPayloads,
  RunEventType,
  RunInstruction,
  RunPlan,
  RunReview,
  RunStage,
} from '@nexus/shared';
import {
  estimateCost,
  MODELS,
  stageRequiresApproval,
  truncate,
} from '@nexus/shared';
import type { ZodType } from 'zod';
import { config } from '../config.js';
import { AppError, Errors } from '../errors.js';
import {
  countArtifactVersions,
  createArtifact,
  listArtifactsForRun,
} from '../repositories/artifacts.js';
import { getTemplate } from '../repositories/templates.js';
import {
  appendEvent,
  consumeInstructions,
  createInstruction,
  getRunInternal,
  incrementRunTotals,
  listUnconsumedInstructions,
  patchRun,
  recoverInterruptedRuns,
} from '../repositories/runs.js';
import { recordUsage } from '../repositories/usage.js';
import {
  getAdapterForUser,
  getConfiguredProviders,
  streamWithRetry,
} from '../providers/service.js';
import { isAbortError, ProviderError } from '../providers/types.js';
import {
  buildPlannerPrompt,
  buildPolisherPrompt,
  buildReviewPrompt,
  buildRevisionPrompt,
  buildWorkerPrompt,
} from './prompts.js';
import { generateStructured } from './structured.js';
import { eventBus, liveRegistry } from './events.js';
import {
  plannerOutputSchema,
  reviewOutputSchema,
  type PlannerOutput,
} from '@nexus/shared';

type ControlMode = 'run' | 'steer' | 'pause' | 'cancel';

interface Control {
  abort: AbortController;
  mode: ControlMode;
}

type StageResult = 'continue' | 'waiting' | 'completed';

interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

class OrchestrationEngine {
  private controls = new Map<string, Control>();
  private queue: string[] = [];
  private pumping = false;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(runId: string): Promise<Run> {
    const run = await getRunInternal(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status !== 'queued') {
      throw Errors.invalidState(`Run cannot be started from status "${run.status}"`);
    }

    const updated = await patchRun(runId, {
      status: 'running',
      startedAt: run.startedAt ?? new Date().toISOString(),
      error: null,
      errorCode: null,
      pendingApproval: null,
    });
    await this.emit(runId, 'run.started', { resumed: false });
    await this.emit(runId, 'run.status', { status: 'running' });
    this.enqueue(runId);
    return updated ?? run;
  }

  async resume(runId: string): Promise<Run> {
    const run = await getRunInternal(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status === 'awaiting_approval') {
      throw Errors.invalidState('Approve or reject the pending decision before resuming');
    }
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw Errors.invalidState(`Run is ${run.status} and cannot be resumed`);
    }
    if (run.status === 'running' && this.controls.has(runId)) return run;

    const updated = await patchRun(runId, {
      status: 'running',
      error: null,
      errorCode: null,
      pendingApproval: null,
    });
    await this.emit(runId, 'run.resumed', { fromStage: run.stage });
    await this.emit(runId, 'run.status', { status: 'running' });
    this.enqueue(runId);
    return updated ?? run;
  }

  async pause(runId: string): Promise<Run> {
    const run = await getRunInternal(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status !== 'running' && run.status !== 'queued') {
      throw Errors.invalidState(`Run cannot be paused from status "${run.status}"`);
    }

    const updated = await patchRun(runId, { status: 'paused' });
    await this.emit(runId, 'run.paused', { reason: 'user' });
    await this.emit(runId, 'run.status', { status: 'paused' });

    this.removeFromQueue(runId);
    const control = this.controls.get(runId);
    if (control) {
      control.mode = 'pause';
      control.abort.abort();
    }
    liveRegistry.clear(runId);
    return updated ?? run;
  }

  async cancel(runId: string, reason: string | null = null): Promise<Run> {
    const run = await getRunInternal(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status === 'completed') {
      throw Errors.invalidState('Completed runs cannot be cancelled');
    }
    if (run.status === 'cancelled') return run;

    const updated = await patchRun(runId, {
      status: 'cancelled',
      pendingApproval: null,
      completedAt: new Date().toISOString(),
    });
    await this.emit(runId, 'run.cancelled', { reason });
    await this.emit(runId, 'run.status', { status: 'cancelled' });

    this.removeFromQueue(runId);
    const control = this.controls.get(runId);
    if (control) {
      control.mode = 'cancel';
      control.abort.abort();
    }
    liveRegistry.clear(runId);
    return updated ?? run;
  }

  async retry(runId: string, restartStage = false): Promise<Run> {
    const run = await getRunInternal(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status === 'awaiting_approval') {
      throw Errors.invalidState('Resolve the pending approval before retrying');
    }
    if (run.status === 'completed') {
      throw Errors.invalidState('Completed runs cannot be retried');
    }

    let plan = run.plan;
    let currentStep = run.currentStep;
    if (plan) {
      const steps = plan.steps.map((step) =>
        step.status === 'running' || (restartStage && run.stage === 'work')
          ? { ...step, status: 'pending' as const, outputArtifactId: null }
          : step
      );
      plan = { ...plan, steps };
      if (restartStage && run.stage === 'work') currentStep = 0;
    }
    if (restartStage && run.stage === 'plan') {
      plan = null;
      currentStep = 0;
    }

    const updated = await patchRun(runId, {
      status: 'running',
      plan,
      currentStep,
      error: null,
      errorCode: null,
      pendingApproval: null,
      completedAt: null,
    });
    await this.emit(runId, 'run.retried', { stage: run.stage });
    await this.emit(runId, 'run.started', { resumed: true });
    await this.emit(runId, 'run.status', { status: 'running' });
    this.enqueue(runId);
    return updated ?? run;
  }

  async steer(runId: string, content: string): Promise<RunInstruction> {
    const run = await getRunInternal(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status === 'completed' || run.status === 'cancelled') {
      throw Errors.invalidState('This run has finished and cannot be steered');
    }

    const instruction = await createInstruction(runId, content, run.stage);
    await this.emit(runId, 'user.instruction', { content });

    const control = this.controls.get(runId);
    if (control && run.status === 'running') {
      control.mode = 'steer';
      control.abort.abort();
    }
    return instruction;
  }

  async approve(
    runId: string,
    decision: 'approve' | 'reject',
    note: string | null
  ): Promise<Run> {
    const run = await getRunInternal(runId);
    if (!run) throw Errors.notFound('Run');
    if (run.status !== 'awaiting_approval' || !run.pendingApproval) {
      throw Errors.invalidState('There is no pending approval for this run');
    }

    const stage = run.pendingApproval.stage;
    await this.emit(runId, 'approval.resolved', {
      stage,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      note,
    });

    if (note && note.trim()) {
      await createInstruction(runId, note.trim(), stage);
      await this.emit(runId, 'user.instruction', { content: note.trim() });
    }

    if (decision === 'approve') {
      const next: RunStage =
        stage === 'plan'
          ? 'work'
          : stage === 'work'
            ? 'review'
            : stage === 'review'
              ? 'polish'
              : stage === 'revise'
                ? 'review'
                : stage === 'polish'
                  ? 'deliver'
                  : 'deliver';

      const updated = await patchRun(runId, {
        status: 'running',
        stage: next,
        pendingApproval: null,
        error: null,
        errorCode: null,
        currentStep: stage === 'plan' ? 0 : run.currentStep,
      });
      await this.emit(runId, 'run.stage', { stage: next, previous: stage });
      await this.emit(runId, 'run.status', { status: 'running' });
      this.enqueue(runId);
      return updated ?? run;
    }

    // Rejection sends work back with the operator's note as a steering
    // instruction. The exact target depends on which gate was rejected.
    let nextStage: RunStage = run.stage;
    let plan = run.plan;
    let currentStep = run.currentStep;
    let reviewRound = run.reviewRound;
    let review = run.review;

    switch (stage) {
      case 'plan':
        nextStage = 'plan';
        plan = null;
        currentStep = 0;
        review = null;
        reviewRound = 0;
        break;
      case 'work':
        nextStage = 'work';
        if (plan) {
          plan = {
            ...plan,
            steps: plan.steps.map((step) => ({
              ...step,
              status: 'pending' as const,
              outputArtifactId: null,
            })),
          };
        }
        currentStep = 0;
        break;
      case 'review':
        nextStage = review ? 'revise' : 'work';
        break;
      case 'revise':
        nextStage = 'revise';
        break;
      case 'polish':
        nextStage = review ? 'revise' : 'polish';
        break;
      case 'deliver':
        nextStage = 'work';
        break;
    }

    const updated = await patchRun(runId, {
      status: 'running',
      stage: nextStage,
      pendingApproval: null,
      plan,
      review,
      reviewRound,
      currentStep,
      error: null,
      errorCode: null,
    });
    await this.emit(runId, 'run.stage', { stage: nextStage, previous: run.stage });
    await this.emit(runId, 'run.status', { status: 'running' });
    this.enqueue(runId);
    return updated ?? run;
  }

  getLive(runId: string) {
    return liveRegistry.get(runId);
  }

  isActive(runId: string): boolean {
    return this.controls.has(runId);
  }

  get activeCount(): number {
    return this.controls.size;
  }

  async recover(): Promise<void> {
    const interrupted = await recoverInterruptedRuns();
    for (const run of interrupted) {
      await this.emit(run.id, 'run.paused', { reason: 'interrupt' });
    }
    if (interrupted.length > 0) {
      console.info(`Recovered ${interrupted.length} interrupted run(s) as paused.`);
    }
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  private enqueue(runId: string) {
    if (!this.queue.includes(runId) && !this.controls.has(runId)) {
      this.queue.push(runId);
    }
    this.pump();
  }

  private removeFromQueue(runId: string) {
    this.queue = this.queue.filter((id) => id !== runId);
  }

  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    queueMicrotask(() => {
      this.pumping = false;
      while (this.controls.size < config.maxConcurrentRuns && this.queue.length > 0) {
        const runId = this.queue.shift()!;
        if (this.controls.has(runId)) continue;
        const control: Control = { abort: new AbortController(), mode: 'run' };
        this.controls.set(runId, control);
        void this.execute(runId, control).catch((error) => {
          console.error('Orchestration loop crashed', { runId, error });
        });
      }
    });
  }

  private async execute(runId: string, control: Control) {
    try {
      while (true) {
        const mode = this.controlMode(control);
        if (mode === 'cancel' || mode === 'pause') break;

        if (mode === 'steer') {
          control.mode = 'run';
          control.abort = new AbortController();
        }

        const run = await getRunInternal(runId);
        if (!run) break;
        if (run.status !== 'running') break;
        if (run.pendingApproval) break;

        try {
          const result = await this.runStage(run, control);
          if (result !== 'continue') break;
        } catch (error) {
          const currentMode = this.controlMode(control);
          if (currentMode === 'steer') {
            control.mode = 'run';
            control.abort = new AbortController();
            await this.resetInProgress(runId);
            continue;
          }
          if (currentMode === 'pause' || currentMode === 'cancel') break;
          await this.failRun(run, error);
          break;
        }
      }
    } finally {
      liveRegistry.clear(runId);
      this.controls.delete(runId);
      this.pump();
    }
  }

  private async runStage(run: Run, control: Control): Promise<StageResult> {
    switch (run.stage) {
      case 'plan':
        return this.handlePlan(run, control);
      case 'work':
        return this.handleWork(run, control);
      case 'review':
        return this.handleReview(run, control);
      case 'revise':
        return this.handleRevise(run, control);
      case 'polish':
        return this.handlePolish(run, control);
      case 'deliver':
        return this.handleDeliver(run);
    }
  }

  // -------------------------------------------------------------------------
  // Stages
  // -------------------------------------------------------------------------

  private async handlePlan(run: Run, control: Control): Promise<StageResult> {
    if (run.plan) {
      await this.setStage(run, 'work');
      return 'continue';
    }

    const planner = this.pickAgent(run, 'planner');
    const template = run.templateId
      ? await getTemplate(run.userId, run.templateId)
      : null;
    const instructions = await listUnconsumedInstructions(run.id);
    const prompt = buildPlannerPrompt({ run, template, instructions });

    const result = await this.runStructured(
      run,
      planner,
      control,
      'plan',
      prompt,
      plannerOutputSchema
    );

    const plan = this.toPlan(result.data);
    await patchRun(run.id, { plan });
    await consumeInstructions(run.id);

    await this.emit(run.id, 'plan.created', { plan });
    await this.emit(
      run.id,
      'agent.message',
      {
        agentId: planner.agentId,
        stage: 'plan',
        text: `**Plan ready — ${plan.steps.length} steps**\n\n${plan.summary}\n\n${plan.approach}`,
      },
      planner.agentId
    );
    await this.emit(
      run.id,
      'agent.completed',
      { agentId: planner.agentId, summary: plan.summary, artifactId: null },
      planner.agentId
    );
    liveRegistry.clear(run.id);

    if (stageRequiresApproval(run.approvalMode, 'plan')) {
      await this.requestApproval(run, 'plan', 'Approve the execution plan', plan.summary);
      return 'waiting';
    }

    await this.setStage(run, 'work');
    return 'continue';
  }

  private async handleWork(run: Run, control: Control): Promise<StageResult> {
    if (!run.plan) throw Errors.invalidState('Run has no plan to execute');

    const plan: RunPlan = {
      ...run.plan,
      steps: run.plan.steps.map((step) => ({ ...step })),
    };
    let index = run.currentStep;

    while (index < plan.steps.length) {
      const step = plan.steps[index]!;
      if (step.status === 'done') {
        index += 1;
        continue;
      }

      plan.steps[index] = { ...step, status: 'running' };
      await patchRun(run.id, { plan, currentStep: index });
      await this.emit(run.id, 'step.updated', { step: plan.steps[index]!, index });

      const agent = this.pickAgent(run, step.assigneeRole);
      const instructions = await listUnconsumedInstructions(run.id);
      const artifacts = await listArtifactsForRun(run.id);
      const prompt = buildWorkerPrompt({
        run,
        step,
        stepIndex: index,
        artifacts,
        instructions,
      });

      const streamed = await this.runStream(
        run,
        agent,
        control,
        'work',
        prompt
      );

      const kind: ArtifactKind = this.detectArtifactKind(step, streamed.text);
      const version =
        (await countArtifactVersions(run.id, kind, step.id)) + 1;
      const artifact = await createArtifact({
        runId: run.id,
        userId: run.userId,
        name: step.title,
        kind,
        mimeType: kind === 'code' ? 'text/x-code' : 'text/markdown',
        content: streamed.text,
        version,
        createdByAgentId: agent.agentId,
        agentName: agent.name,
        stepId: step.id,
      });

      await consumeInstructions(run.id);
      await this.emit(run.id, 'artifact.created', {
        artifactId: artifact.id,
        name: artifact.name,
        kind: artifact.kind,
        version: artifact.version,
      });
      await this.emit(
        run.id,
        'agent.completed',
        {
          agentId: agent.agentId,
          summary: truncate(streamed.text.replace(/[#*`]/g, '').trim(), 240),
          artifactId: artifact.id,
        },
        agent.agentId
      );
      liveRegistry.clear(run.id);

      plan.steps[index] = {
        ...plan.steps[index]!,
        status: 'done',
        outputArtifactId: artifact.id,
      };
      index += 1;
      await patchRun(run.id, { plan, currentStep: index });
      await this.emit(run.id, 'step.updated', { step: plan.steps[index - 1]!, index: index - 1 });
    }

    if (stageRequiresApproval(run.approvalMode, 'work')) {
      await this.requestApproval(
        run,
        'work',
        'Review the deliverables before audit',
        `${plan.steps.length} deliverables are ready. Approve to send them to the reviewer.`
      );
      return 'waiting';
    }

    await this.setStage(run, 'review');
    return 'continue';
  }

  private async handleReview(run: Run, control: Control): Promise<StageResult> {
    const artifacts = await listArtifactsForRun(run.id);
    if (artifacts.length === 0) {
      throw Errors.invalidState('There are no deliverables to review');
    }
    const reviewer = this.pickAgent(run, 'reviewer');
    const instructions = await listUnconsumedInstructions(run.id);
    const prompt = buildReviewPrompt({ run, artifacts, instructions });

    const result = await this.runStructured(
      run,
      reviewer,
      control,
      'review',
      prompt,
      reviewOutputSchema
    );

    const review: RunReview = {
      verdict: result.data.verdict,
      score: result.data.score,
      summary: result.data.summary,
      strengths: result.data.strengths,
      issues: result.data.issues,
      requiredChanges: result.data.requiredChanges,
      round: run.reviewRound + 1,
      createdAt: new Date().toISOString(),
    };

    await patchRun(run.id, { review, reviewRound: review.round });
    await consumeInstructions(run.id);
    await this.emit(run.id, 'review.completed', { review });
    await this.emit(
      run.id,
      'agent.message',
      {
        agentId: reviewer.agentId,
        stage: 'review',
        text: this.formatReviewMessage(review),
      },
      reviewer.agentId
    );
    await this.emit(
      run.id,
      'agent.completed',
      { agentId: reviewer.agentId, summary: review.summary, artifactId: null },
      reviewer.agentId
    );
    liveRegistry.clear(run.id);

    if (review.verdict === 'revise') {
      if (review.round < 2) {
        await this.setStage(run, 'revise');
        const worker = run.agents.find((agent) => agent.role === 'worker');
        if (worker) {
          await this.emit(run.id, 'agent.handoff', {
            fromAgentId: reviewer.agentId,
            toAgentId: worker.agentId,
            reason: `Review round ${review.round} requires revision`,
          });
        }
        return 'continue';
      }

      await this.requestApproval(
        run,
        'review',
        'Reviewer still has concerns',
        `After ${review.round} rounds the reviewer scored this ${review.score}/100. Approve to polish anyway, or reject with guidance to revise.`
      );
      return 'waiting';
    }

    if (stageRequiresApproval(run.approvalMode, 'review')) {
      await this.requestApproval(
        run,
        'review',
        'Review passed — approve polish',
        `Score ${review.score}/100. ${review.summary}`
      );
      return 'waiting';
    }

    await this.setStage(run, 'polish');
    return 'continue';
  }

  private async handleRevise(run: Run, control: Control): Promise<StageResult> {
    if (!run.review) throw Errors.invalidState('There is no review feedback to revise against');
    const worker = this.pickAgent(run, 'worker');
    const artifacts = await listArtifactsForRun(run.id);
    const instructions = await listUnconsumedInstructions(run.id);
    const prompt = buildRevisionPrompt({
      run,
      review: run.review,
      artifacts,
      instructions,
    });

    const streamed = await this.runStream(run, worker, control, 'revise', prompt);
    const version =
      (await countArtifactVersions(run.id, 'document', null)) + 1;
    const artifact = await createArtifact({
      runId: run.id,
      userId: run.userId,
      name: `Revision ${run.revisionCount + 1} — ${run.title}`,
      kind: 'document',
      mimeType: 'text/markdown',
      content: streamed.text,
      version,
      createdByAgentId: worker.agentId,
      agentName: worker.name,
      stepId: null,
    });

    await patchRun(run.id, {
      revisionCount: run.revisionCount + 1,
      currentStep: 0,
    });
    await consumeInstructions(run.id);
    await this.emit(run.id, 'artifact.created', {
      artifactId: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      version: artifact.version,
    });
    await this.emit(
      run.id,
      'agent.completed',
      {
        agentId: worker.agentId,
        summary: 'Revision applied from reviewer feedback.',
        artifactId: artifact.id,
      },
      worker.agentId
    );
    liveRegistry.clear(run.id);
    await this.setStage(run, 'review');
    return 'continue';
  }

  private async handlePolish(run: Run, control: Control): Promise<StageResult> {
    const polisher = this.pickAgent(run, 'polisher');
    const artifacts = await listArtifactsForRun(run.id);
    const instructions = await listUnconsumedInstructions(run.id);
    const prompt = buildPolisherPrompt({
      run,
      artifacts,
      review: run.review,
      instructions,
    });

    const streamed = await this.runStream(run, polisher, control, 'polish', prompt);
    const version =
      (await countArtifactVersions(run.id, 'deliverable', null)) + 1;
    const artifact = await createArtifact({
      runId: run.id,
      userId: run.userId,
      name: `${run.title} — Final deliverable`,
      kind: 'deliverable',
      mimeType: 'text/markdown',
      content: streamed.text,
      version,
      createdByAgentId: polisher.agentId,
      agentName: polisher.name,
      stepId: null,
    });

    await patchRun(run.id, { finalArtifactId: artifact.id });
    await consumeInstructions(run.id);
    await this.emit(run.id, 'artifact.created', {
      artifactId: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      version: artifact.version,
    });
    await this.emit(
      run.id,
      'agent.completed',
      {
        agentId: polisher.agentId,
        summary: 'Final deliverable prepared.',
        artifactId: artifact.id,
      },
      polisher.agentId
    );
    liveRegistry.clear(run.id);

    if (stageRequiresApproval(run.approvalMode, 'polish')) {
      await this.requestApproval(
        run,
        'polish',
        'Approve the final deliverable',
        'The polished deliverable is ready. Approve to complete this run.'
      );
      return 'waiting';
    }

    await this.setStage(run, 'deliver');
    return 'continue';
  }

  private async handleDeliver(run: Run): Promise<StageResult> {
    await patchRun(run.id, {
      status: 'completed',
      stage: 'deliver',
      completedAt: new Date().toISOString(),
      pendingApproval: null,
      error: null,
      errorCode: null,
    });
    await this.emit(run.id, 'run.completed', {
      finalArtifactId: run.finalArtifactId,
    });
    await this.emit(run.id, 'run.status', { status: 'completed' });
    liveRegistry.clear(run.id);
    return 'completed';
  }

  // -------------------------------------------------------------------------
  // Provider execution
  // -------------------------------------------------------------------------

  private async runStream(
    run: Run,
    agent: RunAgent,
    control: Control,
    stage: RunStage,
    prompt: { system: string; user: string }
  ): Promise<{
    text: string;
    provider: ProviderId;
    model: string;
    usage: AgentUsage;
  }> {
    let choice: { provider: ProviderId; model: string } = {
      provider: agent.provider,
      model: agent.model,
    };
    let usedFallback = false;

    while (true) {
      const adapter = await getAdapterForUser(run.userId, choice.provider);
      const startedAt = Date.now();
      let text = '';
      let pending = '';
      let lastFlush = Date.now();
      let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };

      await this.emit(
        run.id,
        'agent.started',
        {
          agentId: agent.agentId,
          agentName: agent.name,
          role: agent.role,
          provider: choice.provider,
          model: choice.model,
          stage,
        },
        agent.agentId
      );
      liveRegistry.start({
        runId: run.id,
        agentId: agent.agentId,
        agentName: agent.name,
        stage,
      });

      const flush = (force = false) => {
        if (!pending) return;
        if (!force && pending.length < 120 && Date.now() - lastFlush < 60) return;
        eventBus.publishToken(run.id, agent.agentId, pending);
        pending = '';
        lastFlush = Date.now();
      };

      try {
        for await (const event of streamWithRetry(
          adapter,
          {
            model: choice.model,
            system: prompt.system,
            messages: [{ role: 'user', content: prompt.user }],
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            signal: control.abort.signal,
          },
          {
            signal: control.abort.signal,
            onRetry: (attempt, error) => {
              console.warn('Retrying provider call', {
                runId: run.id,
                provider: choice.provider,
                attempt,
                message: error.message,
              });
            },
          }
        )) {
          if (event.type === 'delta') {
            text += event.text;
            liveRegistry.append(run.id, agent.agentId, event.text);
            pending += event.text;
            flush();
          } else if (event.type === 'usage') {
            usage = {
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
            };
          }
        }
        flush(true);

        const latencyMs = Date.now() - startedAt;
        await this.recordAgentUsage(
          run,
          agent,
          choice.provider,
          choice.model,
          usage,
          latencyMs,
          'success'
        );

        await this.emit(
          run.id,
          'agent.message',
          { agentId: agent.agentId, text, stage },
          agent.agentId
        );

        return { text, provider: choice.provider, model: choice.model, usage };
      } catch (error) {
        flush(true);
        if (
          this.controlMode(control) !== 'run' ||
          control.abort.signal.aborted ||
          isAbortError(error)
        ) {
          throw error;
        }

        await this.recordAgentUsage(
          run,
          agent,
          choice.provider,
          choice.model,
          { inputTokens: 0, outputTokens: 0 },
          Date.now() - startedAt,
          'error'
        );

        if (usedFallback) throw error;
        const fallback = await this.pickFallback(run, choice.provider);
        if (!fallback) throw error;

        usedFallback = true;
        await this.emit(
          run.id,
          'agent.fallback',
          {
            agentId: agent.agentId,
            fromProvider: choice.provider,
            fromModel: choice.model,
            toProvider: fallback.provider,
            toModel: fallback.model,
            reason: error instanceof Error ? error.message : 'Provider call failed',
          },
          agent.agentId
        );
        liveRegistry.clear(run.id);
        choice = fallback;
      }
    }
  }

  private async runStructured<T>(
    run: Run,
    agent: RunAgent,
    control: Control,
    stage: RunStage,
    prompt: { system: string; user: string },
    schema: ZodType<T>
  ): Promise<{ data: T; provider: ProviderId; model: string }> {
    let choice: { provider: ProviderId; model: string } = {
      provider: agent.provider,
      model: agent.model,
    };
    let usedFallback = false;

    while (true) {
      const adapter = await getAdapterForUser(run.userId, choice.provider);
      const startedAt = Date.now();

      await this.emit(
        run.id,
        'agent.started',
        {
          agentId: agent.agentId,
          agentName: agent.name,
          role: agent.role,
          provider: choice.provider,
          model: choice.model,
          stage,
        },
        agent.agentId
      );
      liveRegistry.start({
        runId: run.id,
        agentId: agent.agentId,
        agentName: agent.name,
        stage,
      });

      try {
        const result = await generateStructured(
          adapter,
          {
            model: choice.model,
            system: prompt.system,
            messages: [{ role: 'user', content: prompt.user }],
            temperature: agent.temperature,
            maxTokens: agent.maxTokens,
            signal: control.abort.signal,
          },
          schema,
          { signal: control.abort.signal }
        );

        await this.recordAgentUsage(
          run,
          agent,
          choice.provider,
          choice.model,
          {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          },
          Date.now() - startedAt,
          'success'
        );
        return { data: result.data, provider: choice.provider, model: choice.model };
      } catch (error) {
        if (
          this.controlMode(control) !== 'run' ||
          control.abort.signal.aborted ||
          isAbortError(error)
        ) {
          liveRegistry.clear(run.id);
          throw error;
        }

        await this.recordAgentUsage(
          run,
          agent,
          choice.provider,
          choice.model,
          { inputTokens: 0, outputTokens: 0 },
          Date.now() - startedAt,
          'error'
        );

        if (usedFallback) {
          liveRegistry.clear(run.id);
          throw error;
        }
        const fallback = await this.pickFallback(run, choice.provider);
        if (!fallback) {
          liveRegistry.clear(run.id);
          throw error;
        }

        usedFallback = true;
        await this.emit(
          run.id,
          'agent.fallback',
          {
            agentId: agent.agentId,
            fromProvider: choice.provider,
            fromModel: choice.model,
            toProvider: fallback.provider,
            toModel: fallback.model,
            reason: error instanceof Error ? error.message : 'Provider call failed',
          },
          agent.agentId
        );
        liveRegistry.clear(run.id);
        choice = fallback;
      }
    }
  }

  private async pickFallback(
    run: Run,
    fromProvider: ProviderId
  ): Promise<{ provider: ProviderId; model: string } | null> {
    const configured = await getConfiguredProviders(run.userId);
    const candidates = configured.filter((provider) => provider !== fromProvider);
    if (candidates.length === 0) return null;

    const otherAgent = run.agents.find(
      (agent) => agent.provider !== fromProvider && candidates.includes(agent.provider)
    );
    if (otherAgent) {
      return { provider: otherAgent.provider, model: otherAgent.model };
    }

    const provider = candidates[0]!;
    const model =
      MODELS.find((entry) => entry.provider === provider && entry.tier === 'balanced') ??
      MODELS.find((entry) => entry.provider === provider && entry.tier === 'frontier') ??
      MODELS.find((entry) => entry.provider === provider);
    if (!model) return null;
    return { provider, model: model.id };
  }

  private async recordAgentUsage(
    run: Run,
    agent: RunAgent,
    provider: ProviderId,
    model: string,
    usage: AgentUsage,
    latencyMs: number,
    status: 'success' | 'error'
  ): Promise<void> {
    const costUsd = estimateCost(model, usage.inputTokens, usage.outputTokens);
    await recordUsage({
      userId: run.userId,
      runId: run.id,
      agentId: agent.agentId,
      agentName: agent.name,
      provider,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      latencyMs,
      status,
    });

    if (status === 'success') {
      await incrementRunTotals(
        run.id,
        usage.inputTokens + usage.outputTokens,
        costUsd
      );
      await this.emit(run.id, 'usage.recorded', {
        provider,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Read the mode through a method so TypeScript does not over-narrow it. */
  private controlMode(control: Control): ControlMode {
    return control.mode;
  }

  private pickAgent(run: Run, role: RunStage | string): RunAgent {
    const exact = run.agents.find((agent) => agent.role === role);
    if (exact) return exact;
    if (role === 'custom') {
      const custom = run.agents.find((agent) => agent.role === 'custom');
      if (custom) return custom;
    }
    if (role === 'worker') {
      const worker = run.agents.find((agent) => agent.role === 'worker');
      if (worker) return worker;
    }
    const fallback =
      run.agents.find((agent) => agent.role === 'worker') ?? run.agents[0];
    if (!fallback) {
      throw Errors.invalidState(`This run has no ${role} agent configured`);
    }
    return fallback;
  }

  private toPlan(output: PlannerOutput): RunPlan {
    const steps: PlanStep[] = output.steps.map((step, index) => ({
      id: `step_${index + 1}`,
      title: step.title,
      description: step.description,
      assigneeRole: step.assigneeRole,
      expectedOutput: step.expectedOutput,
      dependsOn: Array.from(
        new Set(step.dependsOn.filter((dependency) => dependency >= 0 && dependency < index))
      ),
      status: 'pending',
      outputArtifactId: null,
    }));

    return {
      summary: output.summary,
      approach: output.approach,
      steps,
      risks: output.risks,
      createdAt: new Date().toISOString(),
    };
  }

  private detectArtifactKind(step: PlanStep, text: string): ArtifactKind {
    const hasCode = /```[\s\S]*?```/.test(text);
    const codeIntent = /code|implement|script|component|schema|query|function|class|api|typescript|python/i.test(
      `${step.title} ${step.expectedOutput} ${step.description}`
    );
    return hasCode && codeIntent ? 'code' : 'document';
  }

  private formatReviewMessage(review: RunReview): string {
    const lines = [
      `**Review round ${review.round} — ${review.score}/100**`,
      '',
      review.summary,
    ];
    if (review.strengths.length > 0) {
      lines.push('', '**Strengths**');
      for (const strength of review.strengths) lines.push(`- ${strength}`);
    }
    if (review.issues.length > 0) {
      lines.push('', '**Issues**');
      for (const issue of review.issues) {
        lines.push(`- **${issue.severity.toUpperCase()}** ${issue.area}: ${issue.description}`);
      }
    }
    if (review.requiredChanges.length > 0) {
      lines.push('', '**Required changes**');
      for (const change of review.requiredChanges) lines.push(`- ${change}`);
    }
    return lines.join('\n');
  }

  private async setStage(run: Run, stage: RunStage): Promise<void> {
    await patchRun(run.id, { stage });
    await this.emit(run.id, 'run.stage', { stage, previous: run.stage });
  }

  private async requestApproval(
    run: Run,
    stage: RunStage,
    title: string,
    summary: string
  ): Promise<void> {
    const pendingApproval = {
      stage,
      title,
      summary,
      requestedAt: new Date().toISOString(),
    };
    await patchRun(run.id, {
      status: 'awaiting_approval',
      pendingApproval,
    });
    await this.emit(run.id, 'approval.requested', { stage, title, summary });
    await this.emit(run.id, 'run.status', { status: 'awaiting_approval' });
    liveRegistry.clear(run.id);
  }

  private async failRun(run: Run, error: unknown): Promise<void> {
    const code =
      error instanceof AppError
        ? error.code
        : error instanceof ProviderError
          ? 'PROVIDER_FAILED'
          : 'RUN_FAILED';
    const message =
      error instanceof Error
        ? error.message
        : 'The run failed unexpectedly. Retry the stage or check the agent configuration.';

    await patchRun(run.id, {
      status: 'failed',
      error: message,
      errorCode: code,
      pendingApproval: null,
    });
    await this.emit(run.id, 'run.failed', { message, code });
    await this.emit(run.id, 'run.status', { status: 'failed' });
    liveRegistry.clear(run.id);
  }

  private async resetInProgress(runId: string): Promise<void> {
    const run = await getRunInternal(runId);
    if (!run?.plan) return;
    let changed = false;
    const steps = run.plan.steps.map((step) => {
      if (step.status === 'running') {
        changed = true;
        return { ...step, status: 'pending' as const };
      }
      return step;
    });
    if (!changed) return;
    const plan = { ...run.plan, steps };
    await patchRun(runId, { plan });
    for (let index = 0; index < steps.length; index += 1) {
      if (steps[index]!.status === 'pending') {
        await this.emit(runId, 'step.updated', { step: steps[index]!, index });
      }
    }
  }

  private async emit<K extends RunEventType>(
    runId: string,
    type: K,
    payload: RunEventPayloads[K],
    agentId: string | null = null
  ): Promise<RunEvent> {
    const event = await appendEvent(runId, type, payload, agentId);
    eventBus.publish(event);
    return event;
  }
}

export const engine = new OrchestrationEngine();
export { OrchestrationEngine };
