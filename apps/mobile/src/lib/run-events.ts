import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  AGENT_STATUS_LABELS,
  EXECUTION_STATE_LABELS,
  RUN_STAGE_LABELS,
  RUN_STATUS_LABELS,
  ROLE_META,
} from '@nexus/shared';
import type { RunEvent } from '@nexus/shared';
import { formatCost, formatTokens } from './format';

type IconName = ComponentProps<typeof Ionicons>['name'];
export type EventTone = 'neutral' | 'ice' | 'mint' | 'amber' | 'danger';

export interface DescribedEvent {
  icon: IconName;
  title: string;
  detail?: string;
  tone: EventTone;
}

export function describeEvent(event: RunEvent): DescribedEvent {
  switch (event.type) {
    case 'run.created':
      return {
        icon: 'add-circle-outline',
        title: 'Run created',
        detail: event.payload.title,
        tone: 'neutral',
      };
    case 'run.started':
      return {
        icon: 'play-outline',
        title: event.payload.resumed ? 'Run resumed' : 'Run started',
        tone: 'ice',
      };
    case 'execution.started':
      return {
        icon: 'rocket-outline',
        title: 'Execution started',
        detail: `Pipeline: ${event.payload.pipeline.join(' → ')}`,
        tone: 'ice',
      };
    case 'execution.state':
      return {
        icon: 'git-network-outline',
        title: `State: ${EXECUTION_STATE_LABELS[event.payload.state]}`,
        detail: `Moved from ${EXECUTION_STATE_LABELS[event.payload.previous]}`,
        tone:
          event.payload.state === 'failed'
            ? 'danger'
            : event.payload.state === 'completed'
              ? 'mint'
              : event.payload.state === 'awaiting_approval' ||
                  event.payload.state === 'paused'
                ? 'amber'
                : 'ice',
      };
    case 'execution.completed':
      return {
        icon: 'checkmark-done-outline',
        title: 'Execution completed',
        detail: `${formatTokens(event.payload.totalTokens)} tokens · ${formatCost(event.payload.totalCostUsd)}`,
        tone: 'mint',
      };
    case 'execution.failed':
      return {
        icon: 'alert-circle-outline',
        title: 'Execution failed',
        detail: event.payload.message,
        tone: 'danger',
      };
    case 'run.stage':
      return {
        icon: 'git-branch-outline',
        title: `${RUN_STAGE_LABELS[event.payload.stage]} stage`,
        detail: `Moved from ${RUN_STAGE_LABELS[event.payload.previous]}`,
        tone: 'ice',
      };
    case 'run.status':
      return {
        icon: 'pulse-outline',
        title: `Status: ${RUN_STATUS_LABELS[event.payload.status]}`,
        tone: event.payload.status === 'failed' ? 'danger' : 'neutral',
      };
    case 'plan.created':
      return {
        icon: 'map-outline',
        title: 'Plan ready',
        detail: event.payload.plan.summary,
        tone: 'ice',
      };
    case 'plan.updated':
      return {
        icon: 'map-outline',
        title: 'Plan updated',
        detail: event.payload.plan.summary,
        tone: 'neutral',
      };
    case 'step.updated':
      return {
        icon: 'checkbox-outline',
        title: event.payload.step.title,
        detail: `Step ${event.payload.index + 1} · ${event.payload.step.status}`,
        tone: event.payload.step.status === 'failed' ? 'danger' : 'neutral',
      };
    case 'agent.started':
      return {
        icon: 'sparkles-outline',
        title: `${event.payload.agentName} started`,
        detail: `${ROLE_META[event.payload.role as keyof typeof ROLE_META]?.label ?? event.payload.role} · ${event.payload.model}`,
        tone: 'ice',
      };
    case 'agent.activated':
      return {
        icon: 'flash-outline',
        title: `${event.payload.agentName} activated`,
        detail: event.payload.task,
        tone: 'ice',
      };
    case 'agent.status':
      return {
        icon:
          event.payload.status === 'failed'
            ? 'alert-circle-outline'
            : event.payload.status === 'completed'
              ? 'checkmark-circle-outline'
              : 'sync-outline',
        title: `${event.payload.agentName} · ${AGENT_STATUS_LABELS[event.payload.status]}`,
        detail: event.payload.detail ?? undefined,
        tone:
          event.payload.status === 'failed'
            ? 'danger'
            : event.payload.status === 'completed'
              ? 'mint'
              : 'neutral',
      };
    case 'agent.output':
      return {
        icon: 'document-text-outline',
        title: `${event.payload.agentName} produced output`,
        detail: event.payload.summary,
        tone: 'mint',
      };
    case 'agent.token':
    case 'agent.message':
      return { icon: 'ellipsis-horizontal', title: 'Agent output', tone: 'neutral' };
    case 'agent.completed':
      return {
        icon: 'checkmark-circle-outline',
        title: 'Agent finished',
        detail: event.payload.summary ?? undefined,
        tone: 'mint',
      };
    case 'agent.failed':
      return {
        icon: 'alert-circle-outline',
        title: 'Agent failed',
        detail: event.payload.message,
        tone: 'danger',
      };
    case 'agent.fallback':
      return {
        icon: 'swap-horizontal-outline',
        title: 'Fallback model',
        detail: `${event.payload.fromModel} → ${event.payload.toModel}`,
        tone: 'amber',
      };
    case 'agent.steered':
      return {
        icon: 'navigate-outline',
        title: 'Steering applied',
        detail: event.payload.instruction,
        tone: 'amber',
      };
    case 'agent.handoff':
      return {
        icon: 'arrow-forward-outline',
        title: 'Agent handoff',
        detail: event.payload.reason,
        tone: 'neutral',
      };
    case 'approval.requested':
      return {
        icon: 'shield-checkmark-outline',
        title: 'Approval requested',
        detail: event.payload.title,
        tone: 'amber',
      };
    case 'approval.granted':
      return {
        icon: 'shield-checkmark-outline',
        title: event.payload.title,
        detail: event.payload.note ?? undefined,
        tone: 'mint',
      };
    case 'approval.resolved':
      return {
        icon: 'shield-checkmark-outline',
        title: event.payload.decision === 'approved' ? 'Approved' : 'Changes requested',
        detail: event.payload.note ?? undefined,
        tone: event.payload.decision === 'approved' ? 'mint' : 'amber',
      };
    case 'review.completed':
      return {
        icon: 'search-outline',
        title: `Review · ${event.payload.review.score}/100`,
        detail: event.payload.review.summary,
        tone: event.payload.review.verdict === 'approve' ? 'mint' : 'amber',
      };
    case 'review.started':
      return {
        icon: 'search-outline',
        title: `Review started · round ${event.payload.round}`,
        detail: `${event.payload.agentName} is auditing ${event.payload.artifactCount} artifact(s)`,
        tone: 'amber',
      };
    case 'revision.requested':
      return {
        icon: 'refresh-circle-outline',
        title: `Revision requested · round ${event.payload.round}`,
        detail:
          event.payload.instructions.length > 0
            ? event.payload.instructions[0]
            : 'The reviewer asked the worker to revise the deliverables.',
        tone: 'amber',
      };
    case 'artifact.created':
      return {
        icon: 'document-text-outline',
        title: 'Artifact created',
        detail: `${event.payload.name} · v${event.payload.version}`,
        tone: 'mint',
      };
    case 'usage.recorded':
      return {
        icon: 'flash-outline',
        title: 'Usage recorded',
        detail: `${formatTokens(
          event.payload.inputTokens + event.payload.outputTokens
        )} tokens · ${formatCost(event.payload.costUsd)}`,
        tone: 'neutral',
      };
    case 'user.instruction':
      return {
        icon: 'chatbox-ellipses-outline',
        title: 'Instruction sent',
        detail: event.payload.content,
        tone: 'ice',
      };
    case 'run.paused':
      return {
        icon: 'pause-outline',
        title: 'Run paused',
        detail: event.payload.reason === 'user' ? 'By you' : 'Interrupted',
        tone: 'amber',
      };
    case 'run.resumed':
      return {
        icon: 'play-outline',
        title: 'Run resumed',
        detail: `From ${RUN_STAGE_LABELS[event.payload.fromStage]}`,
        tone: 'ice',
      };
    case 'run.cancelled':
      return {
        icon: 'close-circle-outline',
        title: 'Run cancelled',
        detail: event.payload.reason ?? undefined,
        tone: 'danger',
      };
    case 'run.retried':
      return {
        icon: 'refresh-outline',
        title: 'Run retried',
        detail: `From ${RUN_STAGE_LABELS[event.payload.stage]}`,
        tone: 'amber',
      };
    case 'run.completed':
      return {
        icon: 'trophy-outline',
        title: 'Run completed',
        tone: 'mint',
      };
    case 'run.failed':
      return {
        icon: 'alert-circle-outline',
        title: 'Run failed',
        detail: event.payload.message,
        tone: 'danger',
      };
    default:
      return { icon: 'ellipse-outline', title: 'Activity', tone: 'neutral' };
  }
}
