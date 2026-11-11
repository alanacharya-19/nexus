import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RUN_STAGE_DESCRIPTIONS, RUN_STAGE_LABELS } from '@nexus/shared';
import type { PendingApproval } from '@nexus/shared';
import { colors, radius, space } from '@/theme';
import { relativeTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

export function WorkspaceApproval({
  approval,
  busy = false,
  onApprove,
  onRequestChanges,
}: {
  approval: PendingApproval;
  busy?: boolean;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  return (
    <Card tone="raised" style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.amber} />
        </View>
        <View style={styles.headerText}>
          <Text variant="bodySemibold">Your review is required</Text>
          <Text variant="caption" tone="tertiary">
            {RUN_STAGE_LABELS[approval.stage]} · requested{' '}
            {relativeTime(approval.requestedAt)}
          </Text>
        </View>
        <Badge label="Blocking" tone="amber" dot />
      </View>

      <View style={styles.body}>
        <Text variant="bodyMedium">{approval.title}</Text>
        <Text variant="body" tone="secondary">
          {approval.summary}
        </Text>
        <Text variant="caption" tone="faint">
          {RUN_STAGE_DESCRIPTIONS[approval.stage]}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label="Approve"
          icon="checkmark"
          size="sm"
          fullWidth
          loading={busy}
          onPress={onApprove}
          style={styles.action}
        />
        <Button
          label="Request changes"
          variant="secondary"
          size="sm"
          fullWidth
          disabled={busy}
          onPress={onRequestChanges}
          style={styles.action}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.lg,
    borderColor: 'rgba(231,196,138,0.28)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.warningSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(231,196,138,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  body: {
    gap: space.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
  },
  action: {
    flex: 1,
  },
});
