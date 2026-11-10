import type { RunStatus } from '@nexus/shared';
import { RUN_STATUS_LABELS } from '@nexus/shared';
import { Badge } from './badge';

const tone: Record<
  RunStatus,
  'neutral' | 'ice' | 'mint' | 'amber' | 'coral' | 'danger' | 'lavender'
> = {
  queued: 'neutral',
  running: 'ice',
  paused: 'amber',
  awaiting_approval: 'amber',
  completed: 'mint',
  failed: 'danger',
  cancelled: 'neutral',
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge
      label={RUN_STATUS_LABELS[status]}
      tone={tone[status]}
      dot={status === 'running' || status === 'awaiting_approval'}
    />
  );
}
