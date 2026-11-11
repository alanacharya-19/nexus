import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import {
  APPROVAL_MODE_LABELS,
  RUN_STAGE_LABELS,
} from '@nexus/shared';
import type { Artifact, RunEvent, RunStatus } from '@nexus/shared';
import {
  useApproveRun,
  useRunAction,
  useRunDetail,
  useSteerRun,
} from '@/hooks/queries';
import { useRunStream } from '@/hooks/use-run-stream';
import { usePersistentDraft, useRunDraftKey } from '@/hooks/use-persistent-draft';
import { describeEvent } from '@/lib/run-events';
import { relativeTime, shortDate } from '@/lib/format';
import { colors, radius, space, useAccent } from '@/theme';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { ListRow } from '@/components/ui/list-row';
import { StatusBadge } from '@/components/runs/status-badge';
import { StagePipeline } from '@/components/runs/stage-pipeline';
import { MessageBlock } from '@/components/chat/message-block';
import { WorkspaceComposer } from '@/components/chat/workspace-composer';
import { WorkspaceApproval } from '@/components/chat/workspace-approval';
import { Appear, StatusDot } from '@/components/ui/animated';
import { ErrorState } from '@/components/ui/error-state';
import { ListSkeleton } from '@/components/ui/loading';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { toast } from '@/stores/toast';

const TERMINAL: RunStatus[] = ['completed', 'failed', 'cancelled'];

export default function WorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccent();
  const scrollRef = useRef<ScrollViewInstance>(null);

  const detailQuery = useRunDetail(id);
  const detail = detailQuery.data;
  const run = detail?.run;
  const isTerminal = run ? TERMINAL.includes(run.status) : false;

  const stream = useRunStream(id, {
    initialEvents: detail?.events ?? [],
    initialLive: detail?.live ?? null,
    enabled: Boolean(run) && !isTerminal,
  });

  const draft = usePersistentDraft(useRunDraftKey(id));
  const pause = useRunAction('pause');
  const resume = useRunAction('resume');
  const cancel = useRunAction('cancel');
  const retry = useRunAction('retry');
  const approve = useApproveRun(id);
  const steer = useSteerRun(id);

  const [actionsOpen, setActionsOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  const events = useMemo(() => {
    const merged = stream.events.length > 0 ? stream.events : (detail?.events ?? []);
    return [...merged].sort((a, b) => a.seq - b.seq);
  }, [detail?.events, stream.events]);

  const milestones = useMemo(
    () => events.filter((event) => event.type !== 'agent.token').slice(-7).reverse(),
    [events]
  );

  const artifacts = detail?.artifacts ?? [];
  const liveText = stream.live?.text;

  useEffect(() => {
    if (liveText !== undefined) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [liveText]);

  if (detailQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <PageHeader back title="Workspace" />
        <View style={styles.loading}>
          <ListSkeleton rows={3} />
        </View>
      </View>
    );
  }

  if (detailQuery.isError || !run) {
    return (
      <View style={styles.flex}>
        <PageHeader back title="Workspace" />
        <View style={styles.loading}>
          <ErrorState
            title="Workspace unavailable"
            message={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : 'This workspace could not be loaded.'
            }
            onRetry={() => detailQuery.refetch()}
          />
        </View>
      </View>
    );
  }

  const canPause = run.status === 'running';
  const canResume = run.status === 'paused';
  const canRetry = run.status === 'failed' || run.status === 'cancelled';
  const canSteer = !isTerminal;
  const live = stream.live;

  const appendContext = (text: string) => {
    draft.setValue(draft.value ? `${draft.value}\n\n${text}` : text);
    setAttachOpen(false);
  };

  const pasteClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text.trim()) {
        toast('Clipboard is empty', 'Copy some context first, then try again.', 'error');
        return;
      }
      appendContext(text.trim());
      toast('Context attached', 'Clipboard text was added to your instruction.', 'success');
    } catch {
      toast('Could not read clipboard', 'Try pasting manually into the composer.', 'error');
    }
  };

  return (
    <View style={styles.flex}>
      <PageHeader
        back
        title={run.title}
        subtitle={`${RUN_STAGE_LABELS[run.stage]} · ${run.projectName ?? 'No project'} · ${relativeTime(run.updatedAt)}`}
        right={
          <>
            <IconButton
              icon="open-outline"
              tone="muted"
              onPress={() => router.push(`/run/${run.id}`)}
              accessibilityLabel="Open full run detail"
            />
            <IconButton
              icon="ellipsis-horizontal"
              tone="muted"
              onPress={() => setActionsOpen(true)}
              accessibilityLabel="Workspace actions"
            />
          </>
        }
      />
      <OfflineBanner />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: space.xxl },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (stream.live) scrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          <View style={styles.thread}>
            <Appear>
              <View style={styles.statusBar}>
                <View style={styles.statusLeft}>
                  <StatusBadge status={run.status} />
                  <Badge label={APPROVAL_MODE_LABELS[run.approvalMode]} tone="neutral" />
                  {!isTerminal ? (
                    <View style={styles.liveBadge}>
                      <StatusDot
                        color={stream.connected ? accent.accent : colors.amber}
                        active={stream.connected}
                        size={5}
                      />
                      <Text variant="caption" tone={stream.connected ? 'primary' : 'amber'}>
                        {stream.connected
                          ? 'Live session'
                          : stream.reconnecting
                            ? 'Reconnecting'
                            : 'Connecting'}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text variant="caption" tone="faint">
                  {shortDate(run.createdAt)}
                </Text>
              </View>
            </Appear>

            <Appear delay={40}>
              <Card tone="flat" style={styles.pipelineCard}>
                <StagePipeline stage={run.stage} status={run.status} />
              </Card>
            </Appear>

            <Appear delay={80}>
              <MessageBlock
                author={{ name: 'You', role: 'Objective' }}
                tone="user"
                time={relativeTime(run.createdAt)}
              >
                <Text variant="body" tone="primary" style={styles.objective}>
                  {run.objective}
                </Text>
                <View style={styles.objectiveMeta}>
                  <Text variant="caption" tone="faint">
                    {run.agents.length} agents · {APPROVAL_MODE_LABELS[run.approvalMode]} approval
                  </Text>
                  {run.plan ? (
                    <Badge
                      label={`${run.plan.steps.length} planned steps`}
                      tone="neutral"
                    />
                  ) : null}
                </View>
              </MessageBlock>
            </Appear>

            {live ? (
              <Appear delay={120}>
                <MessageBlock
                  author={{
                    name: live.agentName,
                    role: RUN_STAGE_LABELS[live.stage],
                    accent:
                      run.agents.find((agent) => agent.agentId === live.agentId)?.accent ??
                      accent.accent,
                  }}
                  streaming={!isTerminal}
                  badge={isTerminal ? undefined : 'Working'}
                  time={relativeTime(live.startedAt)}
                >
                  <Text variant="mono" style={styles.liveText}>
                    {live.text || 'Reading the brief and preparing the first response…'}
                  </Text>
                </MessageBlock>
              </Appear>
            ) : run.status === 'queued' ? (
              <Appear delay={120}>
                <MessageBlock
                  author={{ name: 'NEXUS', role: 'Orchestrator', accent: accent.accent }}
                  streaming
                  badge="Planning"
                >
                  <Text variant="body" tone="secondary">
                    The lineup is being assembled. The planner will return with a structured
                    plan before the first work step begins.
                  </Text>
                </MessageBlock>
              </Appear>
            ) : null}

            {run.pendingApproval ? (
              <Appear delay={140}>
                <WorkspaceApproval
                  approval={run.pendingApproval}
                  busy={approve.isPending}
                  onApprove={() => approve.mutate({ decision: 'approve' })}
                  onRequestChanges={() => setRejectOpen(true)}
                />
              </Appear>
            ) : null}

            {run.plan ? (
              <Appear delay={160}>
                <MessageBlock
                  author={{
                    name:
                      run.agents.find((agent) => agent.role === 'planner')?.name ?? 'Planner',
                    role: 'Plan',
                    accent: colors.ice,
                  }}
                  time={relativeTime(run.plan.createdAt)}
                >
                  <Text variant="body" tone="primary">
                    {run.plan.summary}
                  </Text>
                  <Text variant="caption" tone="tertiary">
                    {run.plan.approach}
                  </Text>
                  <View style={styles.stepPreview}>
                    {run.plan.steps.slice(0, 5).map((step, index) => (
                      <View key={step.id} style={styles.stepRow}>
                        <View
                          style={[
                            styles.stepIndex,
                            step.status === 'done' && {
                              backgroundColor: accent.accent,
                              borderColor: accent.accent,
                            },
                          ]}
                        >
                          {step.status === 'done' ? (
                            <Ionicons
                              name="checkmark"
                              size={9}
                              color={accent.onAccent}
                            />
                          ) : (
                            <Text variant="monoSmall" tone="faint">
                              {index + 1}
                            </Text>
                          )}
                        </View>
                        <Text
                          variant="caption"
                          tone={step.status === 'pending' ? 'tertiary' : 'secondary'}
                          numberOfLines={2}
                          style={styles.stepText}
                        >
                          {step.title}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <Button
                    label="Open the full plan"
                    variant="ghost"
                    size="sm"
                    icon="arrow-forward"
                    iconPosition="right"
                    onPress={() => router.push(`/run/${run.id}`)}
                  />
                </MessageBlock>
              </Appear>
            ) : null}

            {run.review ? (
              <Appear delay={180}>
                <MessageBlock
                  author={{
                    name:
                      run.agents.find((agent) => agent.role === 'reviewer')?.name ?? 'Reviewer',
                    role: `Review · round ${run.review.round}`,
                    accent: colors.amber,
                  }}
                  badge={`${run.review.score}/100`}
                  time={relativeTime(run.review.createdAt)}
                >
                  <Text variant="body" tone="primary">
                    {run.review.summary}
                  </Text>
                  {run.review.issues.length > 0 ? (
                    <Text variant="caption" tone="tertiary">
                      {run.review.issues.length} issues flagged ·{' '}
                      {run.review.requiredChanges.length} required changes
                    </Text>
                  ) : (
                    <Text variant="caption" tone="mint">
                      No blocking issues. Ready to deliver.
                    </Text>
                  )}
                </MessageBlock>
              </Appear>
            ) : null}

            {run.status === 'failed' ? (
              <Card tone="danger" style={styles.failureCard}>
                <View style={styles.failureHeader}>
                  <Ionicons name="alert-circle" size={17} color={colors.danger} />
                  <Text variant="bodySemibold" tone="danger" style={styles.flexText}>
                    {run.error ?? 'The run stopped unexpectedly.'}
                  </Text>
                </View>
                <Button
                  label="Retry the failed stage"
                  size="sm"
                  variant="secondary"
                  loading={retry.isPending}
                  onPress={() => retry.mutate({ id, restartStage: true })}
                />
              </Card>
            ) : null}

            {artifacts.length > 0 ? (
              <Appear delay={200}>
                <View>
                  <View style={styles.sectionRow}>
                    <Text variant="label">Deliverables</Text>
                    <Text variant="caption" tone="faint">
                      {artifacts.length} produced
                    </Text>
                  </View>
                  <Card padded={false}>
                    {artifacts.map((artifact, index) => (
                      <ArtifactLine
                        key={artifact.id}
                        artifact={artifact}
                        showDivider={index < artifacts.length - 1}
                        onPress={() => router.push(`/artifact/${artifact.id}`)}
                      />
                    ))}
                  </Card>
                </View>
              </Appear>
            ) : null}

            <Appear delay={220}>
              <View>
                <View style={styles.sectionRow}>
                  <Text variant="label">Execution</Text>
                  <Text variant="caption" tone="faint">
                    {events.filter((event) => event.type !== 'agent.token').length} milestones
                  </Text>
                </View>
                <Card padded={false}>
                  {milestones.length === 0 ? (
                    <View style={styles.milestoneEmpty}>
                      <ActivityIndicator size="small" color={colors.textTertiary} />
                      <Text variant="caption" tone="tertiary">
                        Waiting for the first milestone
                      </Text>
                    </View>
                  ) : (
                    milestones.map((event, index) => (
                      <MilestoneRow
                        key={`${event.seq}:${event.id}`}
                        event={event}
                        showDivider={index < milestones.length - 1}
                      />
                    ))
                  )}
                </Card>
                <Button
                  label="Open run detail, plan, and activity"
                  variant="ghost"
                  size="sm"
                  icon="chevron-forward"
                  iconPosition="right"
                  onPress={() => router.push(`/run/${run.id}`)}
                  style={styles.detailLink}
                />
              </View>
            </Appear>
          </View>
        </ScrollView>

        <View
          style={[
            styles.composerWrap,
            { paddingBottom: Math.max(insets.bottom, space.md) },
          ]}
        >
          <WorkspaceComposer
            value={draft.value}
            onChangeText={draft.setValue}
            onSend={() => {
              const content = draft.value.trim();
              if (!content) return;
              steer.mutate(content, {
                onSuccess: () => void draft.clear(),
              });
            }}
            onAttach={() => setAttachOpen(true)}
            busy={steer.isPending}
            disabled={!canSteer}
            loading={!draft.hydrated}
            hint={
              canSteer
                ? 'Instructions are applied at the next safe point'
                : 'This workspace is complete'
            }
          />
        </View>
      </KeyboardAvoidingView>

      <Sheet
        visible={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Add context"
        subtitle="Attach material to your next instruction. Nothing leaves this device until you send."
        footer={
          <Button
            label="Clear draft"
            variant="ghost"
            fullWidth
            onPress={() => {
              void draft.clear();
              setAttachOpen(false);
              toast('Draft cleared', 'The composer is empty.', 'success');
            }}
          />
        }
      >
        <Card padded={false}>
          <ListRow
            icon="clipboard-outline"
            title="Paste from clipboard"
            subtitle="Add copied notes, a brief, or feedback"
            onPress={() => void pasteClipboard()}
            showDivider={artifacts.length > 0}
          />
          {artifacts.slice(0, 4).map((artifact, index) => (
            <ListRow
              key={artifact.id}
              icon="document-text-outline"
              title={`Reference ${artifact.name}`}
              subtitle={`${artifact.kind} · v${artifact.version}`}
              onPress={() =>
                appendContext(`Reference this artifact: ${artifact.name} (${artifact.kind})`)
              }
              showDivider={index < Math.min(artifacts.length, 4) - 1}
            />
          ))}
        </Card>
        <Text variant="caption" tone="faint">
          Attachments are referenced by name in the instruction so agents keep the run&apos;s
          existing context intact.
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
          The note becomes a binding instruction for the next stage.
        </Text>
      </Sheet>

      <Sheet
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title="Workspace actions"
        subtitle="Control this session without leaving the conversation."
        scrollable={false}
      >
        <Card padded={false}>
          {canPause ? (
            <ListRow
              icon="pause-outline"
              title="Pause session"
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
              title="Resume session"
              subtitle="Continue from the current stage."
              onPress={() => {
                setActionsOpen(false);
                resume.mutate({ id });
              }}
              showDivider
            />
          ) : null}
          {canRetry ? (
            <ListRow
              icon="refresh-outline"
              title="Retry session"
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
              title="Stop session"
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
            icon="open-outline"
            title="Open full run detail"
            subtitle="Plan, review, usage, and the complete event trail."
            onPress={() => {
              setActionsOpen(false);
              router.push(`/run/${id}`);
            }}
          />
        </Card>
      </Sheet>
    </View>
  );
}

function ArtifactLine({
  artifact,
  showDivider,
  onPress,
}: {
  artifact: Artifact;
  showDivider: boolean;
  onPress: () => void;
}) {
  return (
    <ListRow
      icon={
        artifact.kind === 'code'
          ? 'code-slash-outline'
          : artifact.kind === 'deliverable'
            ? 'trophy-outline'
            : 'document-text-outline'
      }
      title={artifact.name}
      subtitle={`${artifact.agentName ?? 'Agent'} · v${artifact.version}`}
      value={relativeTime(artifact.createdAt)}
      onPress={onPress}
      showDivider={showDivider}
    />
  );
}

function MilestoneRow({ event, showDivider }: { event: RunEvent; showDivider: boolean }) {
  const described = describeEvent(event);
  return (
    <View style={[styles.milestone, showDivider && styles.milestoneDivider]}>
      <Text variant="caption" tone="faint" style={styles.milestoneTime}>
        {relativeTime(event.createdAt)}
      </Text>
      <View style={styles.milestoneDot}>
        <View
          style={[
            styles.milestoneCore,
            {
              backgroundColor:
                described.tone === 'mint'
                  ? colors.mint
                  : described.tone === 'amber'
                    ? colors.amber
                    : described.tone === 'danger'
                      ? colors.danger
                      : colors.textTertiary,
            },
          ]}
        />
      </View>
      <View style={styles.milestoneText}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {described.title}
        </Text>
        {described.detail ? (
          <Text variant="caption" tone="tertiary" numberOfLines={2}>
            {described.detail}
          </Text>
        ) : null}
      </View>
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
  loading: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
  thread: {
    gap: space.xl,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
    flex: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pipelineCard: {
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  objective: {
    fontSize: 15,
    lineHeight: 23,
  },
  objectiveMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    flexWrap: 'wrap',
    marginTop: space.xs,
  },
  liveText: {
    lineHeight: 21,
  },
  stepPreview: {
    gap: space.sm,
    marginTop: space.xs,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  stepIndex: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    flex: 1,
  },
  failureCard: {
    gap: space.md,
  },
  failureHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
    gap: space.md,
  },
  milestone: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  milestoneDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  milestoneTime: {
    width: 54,
    marginTop: 2,
  },
  milestoneDot: {
    width: 10,
    paddingTop: 5,
    alignItems: 'center',
  },
  milestoneCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  milestoneText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  milestoneEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.lg,
  },
  detailLink: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
  },
  composerWrap: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
});
