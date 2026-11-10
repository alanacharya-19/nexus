import { StyleSheet, View } from 'react-native';
import type { Run } from '@nexus/shared';
import { RUN_STAGE_LABELS } from '@nexus/shared';
import { colors, radius, space } from '@/theme';
import { formatCost, relativeTime, runProgress } from '@/lib/format';
import { Avatar } from '../ui/avatar';
import { Card } from '../ui/card';
import { ProgressBar } from '../ui/progress';
import { Text } from '../ui/text';
import { StatusBadge } from './status-badge';

export function RunCard({ run, onPress }: { run: Run; onPress: () => void }) {
  const progress = runProgress(run);
  const running = run.status === 'running';
  const activeAgents = run.agents.slice(0, 4);

  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <View style={styles.metaRow}>
            <StatusBadge status={run.status} />
            <Text variant="caption" tone="faint">
              {RUN_STAGE_LABELS[run.stage]}
            </Text>
            {run.projectName ? (
              <>
                <View style={styles.metaDot} />
                <Text variant="caption" tone="faint" numberOfLines={1}>
                  {run.projectName}
                </Text>
              </>
            ) : null}
          </View>
          <Text variant="bodySemibold" numberOfLines={2} style={styles.title}>
            {run.title}
          </Text>
        </View>
      </View>

      <ProgressBar
        progress={progress}
        color={running ? colors.ice : run.status === 'completed' ? colors.mint : colors.textTertiary}
        style={styles.progress}
      />

      <View style={styles.footer}>
        <View style={styles.agents}>
          {activeAgents.map((agent, index) => (
            <Avatar
              key={agent.agentId}
              name={agent.name}
              accent={agent.accent}
              size={22}
              style={index > 0 ? styles.avatarOverlap : undefined}
            />
          ))}
          <Text variant="caption" tone="faint" style={styles.agentLabel}>
            {run.agents.length} agents
          </Text>
        </View>
        <View style={styles.footerRight}>
          {run.totalCostUsd > 0 ? (
            <Text variant="caption" tone="tertiary">
              {formatCost(run.totalCostUsd)}
            </Text>
          ) : null}
          <Text variant="caption" tone="faint">
            {relativeTime(run.updatedAt)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
  },
  header: {
    flexDirection: 'row',
    gap: space.md,
  },
  titleWrap: {
    flex: 1,
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  metaDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.textFaint,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
  },
  progress: {
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  agents: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarOverlap: {
    marginLeft: -6,
  },
  agentLabel: {
    marginLeft: space.sm,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
});

export const runCardRadius = radius;
