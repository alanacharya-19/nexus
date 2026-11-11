import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PROVIDER_META } from '@nexus/shared';
import type { UsageBucket } from '@nexus/shared';
import { useUsageRecords, useUsageSummary } from '@/hooks/queries';
import { formatCost, formatTokens, relativeTime, dayLabel } from '@/lib/format';
import { colors, radius, space } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { SectionHeader } from '@/components/ui/section-header';
import { ListSkeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineBanner } from '@/components/ui/offline-banner';

type WindowDays = '7' | '30' | '90';

const WINDOW_OPTIONS: { label: string; value: WindowDays }[] = [
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
];

export default function UsageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState<WindowDays>('30');
  const summaryQuery = useUsageSummary(Number(days));
  const recordsQuery = useUsageRecords(100);
  const summary = summaryQuery.data;
  const records = recordsQuery.data ?? [];

  const maxDayCost = useMemo(
    () => Math.max(0.0001, ...(summary?.byDay.map((day) => day.costUsd) ?? [0])),
    [summary]
  );

  return (
    <View style={styles.flex}>
      <PageHeader
        back
        title="Usage"
        subtitle="Exact token accounting and spend from your provider calls"
      />
      <OfflineBanner />
      <ScrollScreen
        refreshing={summaryQuery.isFetching || recordsQuery.isFetching}
        onRefresh={() => {
          void summaryQuery.refetch();
          void recordsQuery.refetch();
        }}
        bottomPadding={insets.bottom + space.xxl}
      >
        {summaryQuery.isLoading ? (
          <ListSkeleton rows={4} />
        ) : summaryQuery.isError ? (
          <ErrorState
            message={summaryQuery.error.message}
            onRetry={() => summaryQuery.refetch()}
          />
        ) : !summary || summary.calls === 0 ? (
          <EmptyState
            icon="stats-chart-outline"
            title="No usage recorded yet"
            description="Every model call is metered. Run an objective and the exact cost will appear here."
            actionLabel="Start a run"
            onAction={() => router.push('/run/new')}
          />
        ) : (
          <View style={styles.stack}>
            <Segmented options={WINDOW_OPTIONS} value={days} onChange={setDays} />

            <View style={styles.stats}>
              <UsageStat
                label="Spend"
                value={formatCost(summary.totalCostUsd)}
                detail={`${days} days`}
                icon="card-outline"
                color={colors.mint}
              />
              <UsageStat
                label="Tokens"
                value={formatTokens(summary.totalTokens)}
                detail={`${formatTokens(summary.totalInputTokens)} in · ${formatTokens(
                  summary.totalOutputTokens
                )} out`}
                icon="flash-outline"
                color={colors.ice}
              />
              <UsageStat
                label="Calls"
                value={String(summary.calls)}
                detail="Provider requests"
                icon="git-network-outline"
                color={colors.amber}
              />
            </View>

            <View>
              <SectionHeader title="Daily spend" subtitle="Including zero-usage days" />
              <Card style={styles.chartCard}>
                <View style={styles.chart}>
                  {summary.byDay.map((day) => {
                    const ratio = day.costUsd / maxDayCost;
                    return (
                      <View key={day.key} style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: Math.max(2, Math.round(ratio * 88)),
                              backgroundColor:
                                day.costUsd > 0 ? colors.ice : colors.surfaceHover,
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
                <View style={styles.chartLabels}>
                  <Text variant="monoSmall" tone="faint">
                    {summary.byDay[0] ? dayLabel(summary.byDay[0].key) : '—'}
                  </Text>
                  <Text variant="monoSmall" tone="faint">
                    peak {formatCost(maxDayCost)}
                  </Text>
                  <Text variant="monoSmall" tone="faint">
                    {summary.byDay[summary.byDay.length - 1]
                      ? dayLabel(summary.byDay[summary.byDay.length - 1]!.key)
                      : '—'}
                  </Text>
                </View>
              </Card>
            </View>

            <Breakdown
              title="By provider"
              subtitle="Where the spend goes"
              buckets={summary.byProvider}
              colorFor={(bucket) =>
                PROVIDER_META[bucket.key as keyof typeof PROVIDER_META]?.accent ?? colors.ice
              }
            />

            <Breakdown
              title="By model"
              subtitle="Model-level cost distribution"
              buckets={summary.byModel}
              colorFor={() => colors.lavender}
            />

            <Breakdown
              title="By agent"
              subtitle="Cost per specialist"
              buckets={summary.byAgent}
              colorFor={() => colors.mint}
            />

            <View>
              <SectionHeader title="Recent calls" subtitle="Latest 100 provider requests" />
              <Card padded={false}>
                {records.map((record, index) => {
                  const meta = PROVIDER_META[record.provider];
                  return (
                    <View
                      key={record.id}
                      style={[styles.call, index < records.length - 1 && styles.callDivider]}
                    >
                      <View style={[styles.callDot, { backgroundColor: meta.accent }]} />
                      <View style={styles.callText}>
                        <Text variant="bodyMedium" numberOfLines={1}>
                          {record.model}
                        </Text>
                        <Text variant="caption" tone="tertiary">
                          {meta.label} · {formatTokens(record.inputTokens)} in ·{' '}
                          {formatTokens(record.outputTokens)} out
                        </Text>
                      </View>
                      <View style={styles.callRight}>
                        <Text variant="caption" tone="secondary">
                          {formatCost(record.costUsd)}
                        </Text>
                        <Text variant="caption" tone="faint">
                          {relativeTime(record.createdAt)}
                        </Text>
                      </View>
                      {record.status === 'error' ? (
                        <Ionicons name="alert-circle" size={14} color={colors.danger} />
                      ) : null}
                    </View>
                  );
                })}
              </Card>
            </View>
          </View>
        )}
      </ScrollScreen>
    </View>
  );
}

function UsageStat({
  label,
  value,
  detail,
  icon,
  color,
}: {
  label: string;
  value: string;
  detail: string;
  icon: 'card-outline' | 'flash-outline' | 'git-network-outline';
  color: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statTop}>
        <Text variant="label">{label}</Text>
        <Ionicons name={icon} size={13} color={color} />
      </View>
      <Text variant="heading" style={styles.statValue}>
        {value}
      </Text>
      <Text variant="caption" tone="faint" numberOfLines={2}>
        {detail}
      </Text>
    </View>
  );
}

function Breakdown({
  title,
  subtitle,
  buckets,
  colorFor,
}: {
  title: string;
  subtitle: string;
  buckets: UsageBucket[];
  colorFor: (bucket: UsageBucket) => string;
}) {
  if (buckets.length === 0) return null;
  const max = Math.max(0.0001, ...buckets.map((bucket) => bucket.costUsd));
  const total = buckets.reduce((sum, bucket) => sum + bucket.costUsd, 0);

  return (
    <View>
      <SectionHeader title={title} subtitle={subtitle} />
      <Card padded={false}>
        {buckets.map((bucket, index) => {
          const share = total > 0 ? (bucket.costUsd / total) * 100 : 0;
          return (
            <View
              key={bucket.key}
              style={[styles.bucket, index < buckets.length - 1 && styles.callDivider]}
            >
              <View style={styles.bucketHeader}>
                <View style={styles.bucketTitle}>
                  <View
                    style={[styles.callDot, { backgroundColor: colorFor(bucket) }]}
                  />
                  <Text variant="bodyMedium" numberOfLines={1} style={styles.flexText}>
                    {bucket.label}
                  </Text>
                </View>
                <Text variant="caption" tone="secondary">
                  {formatCost(bucket.costUsd)}
                </Text>
              </View>
              <View style={styles.bucketTrack}>
                <View
                  style={[
                    styles.bucketFill,
                    {
                      width: `${Math.max(2, (bucket.costUsd / max) * 100)}%`,
                      backgroundColor: colorFor(bucket),
                    },
                  ]}
                />
              </View>
              <View style={styles.bucketMeta}>
                <Text variant="monoSmall" tone="faint">
                  {formatTokens(bucket.tokens)} tokens · {bucket.calls} calls
                </Text>
                <Text variant="monoSmall" tone="faint">
                  {share.toFixed(1)}%
                </Text>
              </View>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flexText: {
    flex: 1,
  },
  stack: {
    gap: space.xxl,
  },
  stats: {
    flexDirection: 'row',
    gap: space.sm,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 3,
  },
  statTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  statValue: {
    fontSize: 19,
    lineHeight: 24,
  },
  chartCard: {
    gap: space.md,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 96,
  },
  barTrack: {
    flex: 1,
    justifyContent: 'flex-end',
    height: '100%',
  },
  bar: {
    width: '100%',
    borderRadius: 2,
  },
  chartLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  call: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  callDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  callDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  callText: {
    flex: 1,
    gap: 1,
    minWidth: 0,
  },
  callRight: {
    alignItems: 'flex-end',
    gap: 1,
  },
  bucket: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
  },
  bucketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  bucketTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
    minWidth: 0,
  },
  bucketTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHigh,
    overflow: 'hidden',
  },
  bucketFill: {
    height: '100%',
    borderRadius: 2,
  },
  bucketMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
});
