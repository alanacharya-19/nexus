import {
  formatCost,
  formatDuration,
  formatTokens,
  RUN_STAGE_LABELS,
  RUN_STATUS_LABELS,
} from '@nexus/shared';
import type { Run, RunStatus } from '@nexus/shared';

export { formatCost, formatDuration, formatTokens };

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff)) return '—';
  const seconds = Math.round(diff / 1_000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function statusLabel(status: RunStatus): string {
  return RUN_STATUS_LABELS[status];
}

export function stageLabel(stage: Run['stage']): string {
  return RUN_STAGE_LABELS[stage];
}

export function runProgress(run: Run): number {
  if (run.status === 'completed') return 1;
  if (run.status === 'cancelled') return 0;
  const order = ['plan', 'work', 'review', 'revise', 'polish', 'deliver'];
  const index = order.indexOf(run.stage);
  if (run.stage === 'work' && run.plan && run.plan.steps.length > 0) {
    const done = run.plan.steps.filter((step) => step.status === 'done').length;
    return Math.min(0.95, (index + done / run.plan.steps.length) / order.length);
  }
  return Math.min(0.98, (index + 0.4) / order.length);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'NX';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const visible = name.length <= 2 ? name[0] ?? '' : name.slice(0, 2);
  return `${visible}•••@${domain}`;
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}
