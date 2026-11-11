import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  APPROVAL_MODE_LABELS,
  ROLE_META,
  RUN_STAGE_DESCRIPTIONS,
  RUN_STAGE_LABELS,
} from '@nexus/shared';
import type { Artifact, RunEvent, RunReview, RunStatus } from '@nexus/shared';
import { api } from '@/lib/api';
import {
  useApproveRun,
  useRunAction,
  useRunDetail,
  useSteerRun,
} from '@/hooks/queries';
import { useRunStream } from '@/hooks/use-run-stream';
import { describeEvent, type EventTone } from '@/lib/run-events';
import {
  formatCost,
  formatDuration,
  formatTokens,
  relativeTime,
  runProgress,
  shortDate,
} from '@/lib/format';
import { colors, radius, space } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { ProgressBar } from '@/components/ui/progress';
import { SectionHeader, Divider } from '@/components/ui/section-header';
import { StagePipeline } from '@/components/runs/stage-pipeline';
import { StatusBadge } from '@/components/runs/status-badge';
import { AgentLineup } from '@/components/runs/agent-pill';
import { ListSkeleton, LoadingState } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { ListRow } from '@/components/ui/list-row';
import { toast } from '@/stores/toast';

const TERMINAL: RunStatus[] = ['completed', 'failed', 'cancelled'];
const EMPTY_EVENTS: RunEvent[] = [];

const STATUS_COLOR: Record<RunStatus, string> = {
  queued: colors.textSecondary,
  running: colors.ice,
  paused: colors.amber,
  awaiting_approval: colors.amber,
  completed: colors.mint,
  failed: colors.danger,
  cancelled: colors.textTertiary,
};

const EVENT_COLOR: Record<EventTone, string> = {
  neutral: colors.textTertiary,
  ice: colors.ice,
  mint: colors.mint,
  amber: colors.amber,
  danger: colors.danger,
};

const SEVERITY_TONE: Record<
  RunReview['issues'][number]['severity'],
  'neutral' | 'ice' | 'amber' | 'danger'
> = {
  low: 'neutral',
  medium: 'ice',
  high: 'amber',
  critical: 'danger',
};

export default function RunDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const detailQuery = useRunDetail(id);
  const detail = detailQuery.data;
  const run = detail?.run;
  const isTerminal = run ? TERMINAL.includes(run.status) : false;

  const stream = useRunStream(id, {
    initialEvents: detail?.events ?? EMPTY_EVENTS,
    initialLive: detail?.live ?? null,
    enabled: Boolean(run) && !isTerminal,
  });

  const pause = useRunAction('pause');
  const resume = useRunAction('resume');
  const cancel = useRunAction('cancel');
  const retry = useRunAction('retry');
  const approve = useApproveRun(id);
  const steer = useSteerRun(id);

  const deleteRun = useMutation({
    mutationFn: () => api.deleteRun(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      toast('Run deleted', 'The run and its activity were removed.', 'success');
      router.back();
    },
    onError: (error) => toast('Could not delete run', error.message, 'error'),
  });

  const [actionsOpen, setActionsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [instruction, setInstruction] = useState('');
  const [showAllEvents, setShowAllEvents] = useState(false);

  if (detailQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <PageHeader back title="Run" />
        <ScrollScreen bottomPadding={insets.bottom + space.xxl}>
          <ListSkeleton rows={3} />
        </ScrollScreen>
      </View>
    );
  }

  if (detailQuery.isError || !run) {
    return (
      <View style={styles.flex}>
        <PageHeader back title="Run" />
        <ScrollScreen bottomPadding={insets.bottom + space.xxl}>
          <ErrorState
            title="Run unavailable"
            message={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : 'This run could not be loaded.'
            }
            onRetry={() => detailQuery.refetch()}
          />
        </ScrollScreen>
      </View>
    );
  }

  const progress = runProgress(run);
  const elapsed = run.startedAt
    ? Math.max(
        0,
        new Date(run.completedAt ?? run.updatedAt).getTime() -
          new Date(run.startedAt).getTime()
      )
    : 0;
  const pendingApproval = run.pendingApproval;
  const canPause = run.status === 'running';
  const canResume = run.status === 'paused';
  const canSteer = !isTerminal;
  const events = stream.events.length > 0 ? stream.events : (detail?.events ?? []);
  const orderedEvents = [...events].sort((a, b) => b.seq - a.seq);
  const visibleEvents = showAllEvents ? orderedEvents : orderedEvents.slice(0, 12);

  return (
    <View style={styles.flex}>
      <PageHeader
        back
        title={run.title}
        subtitle={`${RUN_STAGE_LABELS[run.stage]} · ${relativeTime(run.updatedAt)}`}
        right={
          <>
            {canPause ? (
              <IconButton
                icon="pause"
                tone="muted"
                onPress={() => pause.mutate({ id })}
                accessibilityLabel="Pause run"
              />
            ) : canResume ? (
              <IconButton
                icon="play"
                tone="muted"
                onPress={() => resume.mutate({ id })}
                accessibilityLabel="Resume run"
              />
            ) : null}
            <IconButton
              icon="ellipsis-horizontal"
              tone="muted"
              onPress={() => setActionsOpen(true)}
              accessibilityLabel="Run actions"
            />
          </>
        }
      />
      <OfflineBanner />
      <ScrollScreen
        refreshing={detailQuery.isFetching}
        onRefresh={() => detailQuery.refetch()}
        bottomPadding={insets.bottom + 110}
      >
        <View style={styles.stack}>
          <Card tone="raised" style={styles.overview}>
            <View style={styles.overviewHeader}>
              <View style={styles.overviewBadges}>
                <StatusBadge status={run.status} />
                <Badge
                  label={APPROVAL_MODE_LABELS[run.approvalMode]}
                  tone="neutral"
                />
                {!isTerminal ? (
                  <Badge
                    label={
                      stream.connected
                        ? 'Live'
                        : stream.reconnecting
                          ? 'Reconnecting'
                          : 'Connecting'
                    }
                    tone={stream.connected ? 'mint' : stream.reconnecting ? 'amber' : 'neutral'}
                    dot
                  />
                ) : null}
              </View>
              {run.projectName ? (
                <Text variant="caption" tone="tertiary" numberOfLines={1}>
                  {run.projectName}
                </Text>
              ) : null}
            </View>

            <ProgressBar progress={progress} color={STATUS_COLOR[run.status]} />

            <StagePipeline stage={run.stage} status={run.status} />

            <View style={styles.statsRow}>
              <MiniStat label="Tokens" value={formatTokens(run.totalTokens)} />
              <MiniStat label="Cost" value={formatCost(run.totalCostUsd)} />
              <MiniStat
                label="Elapsed"
                value={elapsed > 0 ? formatDuration(elapsed) : '—'}
              />
              <MiniStat label="Reviews" value={String(run.reviewRound)} />
            </View>

            <View style={styles.objective}>
              <Text variant="label">Objective</Text>
              <Text variant="body" tone="secondary" style={styles.objectiveText}>
                {run.objective}
              </Text>
            </View>

            <View style={styles.metaGrid}>
              <MetaItem label="Started" value={shortDate(run.startedAt)} />
              <MetaItem label="Updated" value={shortDate(run.updatedAt)} />
              <MetaItem
                label="Step"
                value={
                  run.plan && run.plan.steps.length > 0
                    ? `${Math.min(run.currentStep + 1, run.plan.steps.length)} / ${run.plan.steps.length}`
                    : 'Planning'
                }
              />
              <MetaItem label="Revisions" value={String(run.revisionCount)} />
            </View>

            <AgentLineup agents={run.agents} />
          </Card>

          {pendingApproval ? (
            <ApprovalCard
              title={pendingApproval.title}
              summary={pendingApproval.summary}
              stage={pendingApproval.stage}
              requestedAt={pendingApproval.requestedAt}
              busy={approve.isPending}
              onApprove={() => approve.mutate({ decision: 'approve' })}
              onReject={() => setRejectOpen(true)}
            />
          ) : null}

          {run.status === 'failed' ? (
            <Card tone="danger" style={styles.failure}>
              <View style={styles.failureHeader}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text variant="bodySemibold" tone="danger" style={styles.flexText}>
                  {run.error ?? 'The run failed.'}
                </Text>
              </View>
              {run.errorCode ? (
                <Text variant="monoSmall" tone="faint">
                  {run.errorCode}
                </Text>
              ) : null}
              <View style={styles.failureActions}>
                <Button
                  label="Retry stage"
                  size="sm"
                  variant="secondary"
                  loading={retry.isPending}
                  onPress={() => retry.mutate({ id, restartStage: true })}
                />
              </View>
            </Card>
          ) : null}

          {stream.error && !isTerminal ? (
            <Card tone="flat" style={styles.streamNotice}>
              <Ionicons name="radio-outline" size={15} color={colors.amber} />
              <Text variant="caption" tone="amber" style={styles.flexText}>
                {stream.error}
              </Text>
            </Card>
          ) : null}

          {stream.live && !isTerminal ? (
            <View>
              <SectionHeader
                title="Live output"
                subtitle={`${stream.live.agentName} · ${RUN_STAGE_LABELS[stream.live.stage]}`}
                action={
                  <Badge
                    label={stream.connected ? 'Streaming' : 'Buffered'}
                    tone={stream.connected ? 'mint' : 'neutral'}
                    dot={stream.connected}
                  />
                }
              />
              <Card tone="flat" style={styles.liveCard}>
                <Text variant="mono" style={styles.liveText}>
                  {truncateTail(stream.live.text, 6_000) || 'Waiting for the first tokens…'}
                </Text>
              </Card>
            </View>
          ) : null}

          <SteeringCard
            disabled={!canSteer}
            value={instruction}
            onChange={setInstruction}
            busy={steer.isPending}
            onSend={() => {
              const content = instruction.trim();
              if (!content) return;
              steer.mutate(content, {
                onSuccess: () => setInstruction(''),
              });
            }}
          />

          {run.plan ? (
            <View>
              <SectionHeader title="Plan" subtitle={run.plan.summary} />
              <Card style={styles.plan}>
                <Text variant="body" tone="secondary">
                  {run.plan.approach}
                </Text>
                <Divider />
                <View style={styles.stepList}>
                  {run.plan.steps.map((step, index) => (
                    <View key={step.id} style={styles.step}>
                      <View
                        style={[
                          styles.stepDot,
                          step.status === 'done' && styles.stepDone,
                          step.status === 'running' && styles.stepRunning,
                          step.status === 'failed' && styles.stepFailed,
                        ]}
                      >
                        {step.status === 'done' ? (
                          <Ionicons name="checkmark" size={10} color={colors.inverse} />
                        ) : null}
                      </View>
                      <View style={styles.stepText}>
                        <View style={styles.stepTitleRow}>
                          <Text
                            variant="bodyMedium"
                            tone={step.status === 'pending' ? 'tertiary' : 'primary'}
                            style={styles.flexText}
                          >
                            {index + 1}. {step.title}
                          </Text>
                          <Badge
                            label={ROLE_META[step.assigneeRole].label}
                            tone="neutral"
                          />
                        </View>
                        <Text variant="caption" tone="tertiary">
                          {step.description}
                        </Text>
                        <Text variant="monoSmall" tone="faint">
                          Expected: {step.expectedOutput}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
                {run.plan.risks.length > 0 ? (
                  <>
                    <Divider />
                    <Text variant="label">Risks</Text>
                    {run.plan.risks.map((risk, index) => (
                      <View key={index} style={styles.riskRow}>
                        <Text variant="caption" tone="amber">
                          ·
                        </Text>
                        <Text variant="caption" tone="tertiary" style={styles.flexText}>
                          {risk}
                        </Text>
                      </View>
                    ))}
                  </>
                ) : null}
              </Card>
            </View>
          ) : null}

          {run.review ? (
            <View>
              <SectionHeader
                title="Review"
                subtitle={`Round ${run.review.round} · ${run.review.verdict === 'approve' ? 'Approved' : 'Changes required'}`}
                action={
                  <Badge
                    label={`${run.review.score}/100`}
                    tone={run.review.score >= 80 ? 'mint' : 'amber'}
                  />
                }
              />
              <ReviewCard review={run.review} />
            </View>
          ) : null}

          <View>
            <SectionHeader
              title="Artifacts"
              subtitle={`${run.agents.length} agents · ${detail?.artifacts.length ?? 0} produced`}
            />
            {!detail || detail.artifacts.length === 0 ? (
              <Card tone="flat" style={styles.emptyCard}>
                <Ionicons name="document-text-outline" size={17} color={colors.textTertiary} />
                <Text variant="caption" tone="tertiary" style={styles.flexText}>
                  Artifacts appear as soon as an agent finishes a step.
                </Text>
              </Card>
            ) : (
              <View style={styles.artifactList}>
                {detail.artifacts.map((artifact) => (
                  <ArtifactRow
                    key={artifact.id}
                    artifact={artifact}
                    onPress={() => router.push(`/artifact/${artifact.id}`)}
                  />
                ))}
              </View>
            )}
          </View>

          <View>
            <SectionHeader
              title="Activity"
              subtitle={`${events.length} events · reconnect-safe`}
              action={
                orderedEvents.length > 12 ? (
                  <Button
                    label={showAllEvents ? 'Show less' : 'Show all'}
                    size="sm"
                    variant="ghost"
                    onPress={() => setShowAllEvents((current) => !current)}
                  />
                ) : undefined
              }
            />
            {visibleEvents.length === 0 ? (
              <LoadingState label="Waiting for events" />
            ) : (
              <Card padded={false}>
                {visibleEvents.map((event, index) => (
                  <TimelineRow
                    key={`${event.seq}:${event.id}`}
                    event={event}
                    showDivider={index < visibleEvents.length - 1}
                  />
                ))}
              </Card>
            )}
          </View>
        </View>
      </ScrollScreen>

      <Sheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title="Run actions"
        subtitle="Control execution or clean up this run."
        scrollable={false}
      >
        <Card padded={false}>
          {canPause ? (
            <ListRow
              icon="pause-outline"
              title="Pause run"
              subtitle="Finish the current agent call, then stop."
              onPress={() => {
                setActionsOpen(false);
                pause.mutate({ id });
              }}
              showDivider
            />
          ) : null}
          {canResume ? (
            <ListRow
              icon="play-outline"
              title="Resume run"
              subtitle="Continue from the current stage."
              onPress={() => {
                setActionsOpen(false);
                resume.mutate({ id });
              }}
              showDivider
            />
          ) : null}
          {run.status === 'failed' || run.status === 'cancelled' ? (
            <ListRow
              icon="refresh-outline"
              title="Retry run"
              subtitle="Restart the failed stage with the same lineup."
              onPress={() => {
                setActionsOpen(false);
                retry.mutate({ id, restartStage: true });
              }}
              showDivider
            />
          ) : null}
          {!isTerminal ? (
            <ListRow
              icon="stop-circle-outline"
              title="Cancel run"
              subtitle="Stop immediately and keep existing artifacts."
              danger
              onPress={() => {
                setActionsOpen(false);
                cancel.mutate({ id });
              }}
              showDivider
            />
          ) : null}
          <ListRow
            icon="trash-outline"
            title="Delete run"
            subtitle={
              isTerminal
                ? 'Remove this run and its activity permanently.'
                : 'Pause or cancel the run before deleting it.'
            }
            danger
            disabled={!isTerminal}
            onPress={() => {
              setActionsOpen(false);
              setDeleteOpen(true);
            }}
          />
        </Card>
      </Sheet>

      <Sheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this run?"
        subtitle="Artifacts and the event timeline will be removed."
        footer={
          <>
            <Button
              label="Delete permanently"
              variant="danger"
              fullWidth
              loading={deleteRun.isPending}
              onPress={() => deleteRun.mutate()}
            />
            <Button
              label="Keep run"
              variant="ghost"
              fullWidth
              onPress={() => setDeleteOpen(false)}
            />
          </>
        }
      >
        <Text variant="body" tone="secondary">
          This cannot be undone. Export anything you need before deleting.
        </Text>
      </Sheet>

      <Sheet
        visible={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Request changes"
        subtitle="Tell the agents exactly what to fix before they continue."
        footer={
          <>
            <Button
              label="Send and continue"
              fullWidth
              loading={approve.isPending}
              disabled={rejectNote.trim().length === 0}
              onPress={() => {
                approve.mutate(
                  { decision: 'reject', note: rejectNote.trim() },
                  {
                    onSuccess: () => {
                      setRejectOpen(false);
                      setRejectNote('');
                    },
                  }
                );
              }}
            />
            <Button
              label="Cancel"
              variant="ghost"
              fullWidth
              onPress={() => setRejectOpen(false)}
            />
          </>
        }
      >
        <Input
          label="Required changes"
          value={rejectNote}
          onChangeText={setRejectNote}
          placeholder="Be specific: what is wrong, and what should change?"
          multiline
        />
        <Text variant="caption" tone="faint">
          The note is treated as a binding instruction for the next stage.
        </Text>
      </Sheet>
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text variant="caption" tone="faint">
        {label}
      </Text>
      <Text variant="bodySemibold" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text variant="caption" tone="faint">
        {label}
      </Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ApprovalCard({
  title,
  summary,
  stage,
  requestedAt,
  busy,
  onApprove,
  onReject,
}: {
  title: string;
  summary: string;
  stage: keyof typeof RUN_STAGE_LABELS;
  requestedAt: string;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <Card tone="raised" style={styles.approvalCard}>
      <View style={styles.approvalHeader}>
        <View style={styles.approvalIcon}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.amber} />
        </View>
        <View style={styles.flexText}>
          <Text variant="bodySemibold">Your review is required</Text>
          <Text variant="caption" tone="tertiary">
            {RUN_STAGE_LABELS[stage]} · requested {relativeTime(requestedAt)}
          </Text>
        </View>
        <Badge label="Blocking" tone="amber" dot />
      </View>
      <View style={styles.approvalBody}>
        <Text variant="bodyMedium">{title}</Text>
        <Text variant="body" tone="secondary">
          {summary}
        </Text>
        <Text variant="caption" tone="faint">
          {RUN_STAGE_DESCRIPTIONS[stage]}
        </Text>
      </View>
      <View style={styles.approvalActions}>
        <Button
          label="Approve"
          icon="checkmark"
          size="sm"
          fullWidth
          loading={busy}
          onPress={onApprove}
          style={styles.flexButton}
        />
        <Button
          label="Request changes"
          variant="secondary"
          size="sm"
          fullWidth
          disabled={busy}
          onPress={onReject}
          style={styles.flexButton}
        />
      </View>
    </Card>
  );
}

function SteeringCard({
  disabled,
  value,
  onChange,
  busy,
  onSend,
}: {
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onSend: () => void;
}) {
  return (
    <View>
      <SectionHeader
        title="Steer"
        subtitle={
          disabled
            ? 'This run is no longer accepting instructions.'
            : 'Instructions are applied at the next safe point.'
        }
      />
      <Card tone="flat" style={styles.steerCard}>
        <Input
          value={value}
          onChangeText={onChange}
          placeholder="Add context, change direction, or tighten the quality bar…"
          multiline
          editable={!disabled}
          containerStyle={styles.flexText}
        />
        <Button
          label="Send"
          icon="arrow-up"
          iconPosition="right"
          size="sm"
          disabled={disabled || value.trim().length === 0}
          loading={busy}
          onPress={onSend}
          style={styles.steerButton}
        />
      </Card>
    </View>
  );
}

function ReviewCard({ review }: { review: RunReview }) {
  return (
    <Card style={styles.review}>
      <View style={styles.reviewHeader}>
        <View style={styles.scoreWrap}>
          <Text variant="title" tone={review.score >= 80 ? 'mint' : 'amber'}>
            {review.score}
          </Text>
          <Text variant="caption" tone="faint">
            /100
          </Text>
        </View>
        <Text variant="body" tone="secondary" style={styles.flexText}>
          {review.summary}
        </Text>
      </View>

      {review.strengths.length > 0 ? (
        <View style={styles.reviewBlock}>
          <Text variant="label">Strengths</Text>
          {review.strengths.map((strength, index) => (
            <View key={index} style={styles.bulletRow}>
              <Ionicons name="checkmark" size={12} color={colors.mint} />
              <Text variant="caption" tone="secondary" style={styles.flexText}>
                {strength}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {review.issues.length > 0 ? (
        <View style={styles.reviewBlock}>
          <Text variant="label">Issues</Text>
          {review.issues.map((issue, index) => (
            <View key={index} style={styles.issue}>
              <View style={styles.issueTop}>
                <Badge label={issue.severity.toUpperCase()} tone={SEVERITY_TONE[issue.severity]} />
                <Text variant="caption" tone="tertiary">
                  {issue.area}
                </Text>
              </View>
              <Text variant="caption" tone="secondary">
                {issue.description}
              </Text>
              <Text variant="caption" tone="faint">
                Suggest: {issue.suggestion}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {review.requiredChanges.length > 0 ? (
        <View style={styles.reviewBlock}>
          <Text variant="label">Required changes</Text>
          {review.requiredChanges.map((change, index) => (
            <View key={index} style={styles.bulletRow}>
              <Text variant="caption" tone="amber">
                {index + 1}.
              </Text>
              <Text variant="caption" tone="secondary" style={styles.flexText}>
                {change}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function ArtifactRow({
  artifact,
  onPress,
}: {
  artifact: Artifact;
  onPress: () => void;
}) {
  return (
    <Card onPress={onPress} style={styles.artifactRow} accessibilityLabel={artifact.name}>
      <View style={styles.artifactIcon}>
        <Ionicons
          name={
            artifact.kind === 'code'
              ? 'code-slash-outline'
              : artifact.kind === 'deliverable'
                ? 'trophy-outline'
                : 'document-text-outline'
          }
          size={15}
          color={colors.ice}
        />
      </View>
      <View style={styles.flexText}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {artifact.name}
        </Text>
        <Text variant="caption" tone="tertiary">
          {artifact.agentName ?? 'Agent'} · v{artifact.version} ·{' '}
          {relativeTime(artifact.createdAt)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
    </Card>
  );
}

function TimelineRow({ event, showDivider }: { event: RunEvent; showDivider: boolean }) {
  const described = describeEvent(event);
  const color = EVENT_COLOR[described.tone];
  return (
    <View style={[styles.timelineRow, showDivider && styles.timelineDivider]}>
      <View style={[styles.timelineIcon, { borderColor: `${color}55` }]}>
        <Ionicons name={described.icon} size={13} color={color} />
      </View>
      <View style={styles.flexText}>
        <View style={styles.timelineTitleRow}>
          <Text variant="bodyMedium" numberOfLines={2} style={styles.flexText}>
            {described.title}
          </Text>
          <Text variant="caption" tone="faint">
            {relativeTime(event.createdAt)}
          </Text>
        </View>
        {described.detail ? (
          <Text variant="caption" tone="tertiary" numberOfLines={3}>
            {described.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function truncateTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return `…${text.slice(text.length - max)}`;
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
  overview: {
    gap: space.lg,
  },
  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  overviewBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  statsRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  miniStat: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.sm,
    gap: 1,
  },
  objective: {
    gap: space.xs,
  },
  objectiveText: {
    lineHeight: 22,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space.md,
  },
  metaItem: {
    width: '50%',
    gap: 1,
  },
  failure: {
    gap: space.md,
  },
  failureHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  failureActions: {
    flexDirection: 'row',
    gap: space.sm,
  },
  streamNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: colors.warningSurface,
    borderColor: 'rgba(231,196,138,0.24)',
  },
  liveCard: {
    backgroundColor: colors.bgElevated,
    maxHeight: 300,
  },
  liveText: {
    fontSize: 12,
    lineHeight: 19,
  },
  steerCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
    backgroundColor: colors.bgElevated,
  },
  steerButton: {
    marginBottom: 2,
  },
  plan: {
    gap: space.md,
  },
  stepList: {
    gap: space.lg,
  },
  step: {
    flexDirection: 'row',
    gap: space.md,
  },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepDone: {
    backgroundColor: colors.mint,
    borderColor: colors.mint,
  },
  stepRunning: {
    backgroundColor: colors.ice,
    borderColor: colors.ice,
  },
  stepFailed: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  stepText: {
    flex: 1,
    gap: 3,
  },
  stepTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  riskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  review: {
    gap: space.lg,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.lg,
  },
  scoreWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 1,
  },
  reviewBlock: {
    gap: space.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  issue: {
    gap: 3,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  issueTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  artifactList: {
    gap: space.sm,
  },
  artifactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  artifactIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(168,199,250,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(168,199,250,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.bgElevated,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  timelineDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  timelineIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  timelineTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  approvalCard: {
    gap: space.md,
    borderColor: 'rgba(231,196,138,0.3)',
  },
  approvalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  approvalIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.warningSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(231,196,138,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalBody: {
    gap: space.xs,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: space.sm,
  },
  flexButton: {
    flex: 1,
  },
  pressed: {
    opacity: 0.75,
  },
});
