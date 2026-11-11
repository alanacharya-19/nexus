import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Agent, Project, UsageSummary, WorkflowTemplate } from '@nexus/shared';
import { PROVIDER_META, ROLE_META, getModel } from '@nexus/shared';
import { useAuthStore } from '@/stores/auth';
import {
  useAgents,
  useProjects,
  useRuns,
  useTemplates,
  useUsageSummary,
} from '@/hooks/queries';
import { formatCost, formatTokens, plural, relativeTime, runProgress } from '@/lib/format';
import { colors, radius, space, useAccent } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { Stat } from '@/components/ui/stat';
import { SectionHeader } from '@/components/ui/section-header';
import { ListSkeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { RunCard } from '@/components/runs/run-card';
import { StatusBadge } from '@/components/runs/status-badge';
import { ProgressBar } from '@/components/ui/progress';
import { BrandMark } from '@/components/navigation/brand-mark';
import { Appear, StatusDot } from '@/components/ui/animated';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccent();
  const user = useAuthStore((state) => state.session?.user);

  const runsQuery = useRuns();
  const templatesQuery = useTemplates();
  const usageQuery = useUsageSummary(30);
  const projectsQuery = useProjects();
  const agentsQuery = useAgents();

  const runs = useMemo(() => runsQuery.data?.runs ?? [], [runsQuery.data?.runs]);
  const activeRuns = useMemo(
    () =>
      runs.filter((run) =>
        ['running', 'awaiting_approval', 'paused', 'queued'].includes(run.status)
      ),
    [runs]
  );
  const recentRuns = useMemo(() => runs.slice(0, 4), [runs]);
  const templates = (templatesQuery.data ?? []).slice(0, 5);
  const projects = (projectsQuery.data ?? []).slice(0, 5);
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const summary = usageQuery.data;

  const firstName = (user?.name ?? user?.email ?? 'there').split(/[\s@]/)[0];
  const workingAgents = useMemo(
    () =>
      new Set(
        activeRuns.flatMap((run) => run.agents.map((agent) => agent.name.toLowerCase()))
      ),
    [activeRuns]
  );
  const enabledAgents = agents.filter((agent) => agent.enabled);

  const openComposer = (input?: { templateId?: string; objective?: string }) => {
    router.push({
      pathname: '/run/new',
      params: {
        ...(input?.templateId ? { templateId: input.templateId } : {}),
        ...(input?.objective ? { objective: input.objective } : {}),
      },
    });
  };

  return (
    <View style={styles.flex}>
      <PageHeader
        eyebrow={<BrandMark size="sm" />}
        title={`${greeting()}, ${firstName}`}
        subtitle="Your agents are ready. Give them a real objective."
        right={
          <>
            <Pressable
              onPress={() => router.push('/usage')}
              accessibilityRole="button"
              accessibilityLabel="Usage and cost"
              hitSlop={6}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <View style={styles.usageButton}>
                <Ionicons name="stats-chart-outline" size={17} color={colors.textTertiary} />
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="Open profile and settings"
              hitSlop={6}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Avatar name={firstName} accent={accent.accent} size={34} />
            </Pressable>
          </>
        }
      />
      <OfflineBanner />
      <ScrollScreen
        refreshing={
          runsQuery.isRefetching ||
          usageQuery.isRefetching ||
          projectsQuery.isRefetching ||
          agentsQuery.isRefetching
        }
        onRefresh={() => {
          void runsQuery.refetch();
          void usageQuery.refetch();
          void templatesQuery.refetch();
          void projectsQuery.refetch();
          void agentsQuery.refetch();
        }}
        bottomPadding={insets.bottom + 110}
      >
        <View style={styles.stack}>
          <Appear>
            <View style={styles.composer}>
              <View style={styles.composerHeader}>
                <View style={styles.composerLabel}>
                  <StatusDot color={accent.accent} active size={5} />
                  <Text variant="label">New task</Text>
                </View>
                <Text variant="caption" tone="faint">
                  Multi-agent workspace
                </Text>
              </View>
              <Pressable
                onPress={() => openComposer()}
                accessibilityRole="button"
                accessibilityLabel="Compose a new task"
                style={styles.objectiveBox}
              >
                <Text variant="body" tone="faint" numberOfLines={3} style={styles.objectiveText}>
                  Describe the outcome you need — a launch brief, an architecture review, a
                  working prototype…
                </Text>
              </Pressable>
              <View style={styles.composerFooter}>
                <View style={styles.quickTemplates}>
                  {templates.slice(0, 2).map((template) => (
                    <Pressable
                      key={template.id}
                      onPress={() => openComposer({ templateId: template.id })}
                      style={styles.quickTemplate}
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name="sparkles-outline"
                        size={12}
                        color={colors.textTertiary}
                      />
                      <Text variant="caption" tone="tertiary" numberOfLines={1}>
                        {template.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Button
                  label="Compose"
                  icon="arrow-forward"
                  iconPosition="right"
                  onPress={() => openComposer()}
                  size="sm"
                />
              </View>
            </View>
          </Appear>

          <Appear delay={40}>
            <View>
              <SectionHeader
                title="Active session"
                subtitle={
                  activeRuns.length > 0
                    ? `${activeRuns.length} workspace${activeRuns.length === 1 ? '' : 's'} in flight`
                    : 'The lineup is idle and ready'
                }
                action={
                  activeRuns.length > 0 ? (
                    <Pressable onPress={() => router.push('/runs')} hitSlop={8}>
                      <Text variant="caption" tone="secondary">
                        View all
                      </Text>
                    </Pressable>
                  ) : undefined
                }
              />
              {runsQuery.isLoading ? (
                <ListSkeleton rows={1} />
              ) : runsQuery.isError ? (
                <ErrorState
                  message={runsQuery.error.message}
                  onRetry={() => runsQuery.refetch()}
                  compact
                />
              ) : activeRuns.length === 0 ? (
                <Card tone="flat" style={styles.idleCard}>
                  <View style={styles.idleIcon}>
                    <Ionicons name="radio-outline" size={18} color={colors.textTertiary} />
                  </View>
                  <View style={styles.idleText}>
                    <Text variant="bodyMedium">No agents are working</Text>
                    <Text variant="caption" tone="tertiary">
                      Compose a task and the pipeline starts immediately.
                    </Text>
                  </View>
                </Card>
              ) : (
                <View style={styles.list}>
                  {activeRuns.slice(0, 3).map((run) => (
                    <Card
                      key={run.id}
                      onPress={() => router.push(`/workspace/${run.id}`)}
                      style={styles.activeCard}
                    >
                      <View style={styles.activeHeader}>
                        <StatusBadge status={run.status} />
                        <Text variant="caption" tone="faint">
                          {relativeTime(run.updatedAt)}
                        </Text>
                      </View>
                      <Text variant="bodySemibold" numberOfLines={2}>
                        {run.title}
                      </Text>
                      <ProgressBar
                        progress={runProgress(run)}
                        color={
                          run.status === 'awaiting_approval' ? colors.amber : accent.accent
                        }
                      />
                      <View style={styles.activeFooter}>
                        <Text variant="caption" tone="tertiary">
                          {run.pendingApproval?.title ?? run.agents[0]?.name ?? 'Agents'}
                        </Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
                      </View>
                    </Card>
                  ))}
                </View>
              )}
            </View>
          </Appear>

          <Appear delay={80}>
            <View>
              <SectionHeader
                title="Recent projects"
                subtitle="Grouped objectives and their deliverables"
                action={
                  <Pressable onPress={() => router.push('/runs')} hitSlop={8}>
                    <Text variant="caption" tone="secondary">
                      History
                    </Text>
                  </Pressable>
                }
              />
              {projectsQuery.isLoading ? (
                <ListSkeleton rows={1} />
              ) : projects.length === 0 ? (
                <EmptyState
                  icon="folder-open-outline"
                  title="No projects yet"
                  description="Projects group related conversations, plans, and final artifacts."
                  actionLabel="Start a task"
                  onAction={() => openComposer()}
                  compact
                />
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.row}
                >
                  {projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onPress={() =>
                        router.push({
                          pathname: '/runs',
                          params: { projectId: project.id },
                        })
                      }
                    />
                  ))}
                </ScrollView>
              )}
            </View>
          </Appear>

          <Appear delay={120}>
            <View>
              <SectionHeader
                title="Recent conversations"
                subtitle="Jump back into a workspace"
                action={
                  <Pressable onPress={() => router.push('/runs')} hitSlop={8}>
                    <Text variant="caption" tone="secondary">
                      View all
                    </Text>
                  </Pressable>
                }
              />
              {runsQuery.isLoading ? (
                <ListSkeleton rows={2} />
              ) : recentRuns.length === 0 ? (
                <EmptyState
                  icon="chatbubbles-outline"
                  title="Nothing has run yet"
                  description="Your first objective will show up here with a full activity trail."
                  actionLabel="Start a task"
                  onAction={() => openComposer()}
                  compact
                />
              ) : (
                <View style={styles.list}>
                  {recentRuns.map((run) => (
                    <RunCard
                      key={run.id}
                      run={run}
                      onPress={() => router.push(`/workspace/${run.id}`)}
                      onOpenArtifact={
                        run.finalArtifactId
                          ? () => router.push(`/artifact/${run.finalArtifactId}`)
                          : undefined
                      }
                    />
                  ))}
                </View>
              )}
            </View>
          </Appear>

          <Appear delay={160}>
            <View>
              <SectionHeader
                title="Workflow shortcuts"
                subtitle="Reusable playbooks with the right approval policy"
                action={
                  <Pressable onPress={() => router.push('/library')} hitSlop={8}>
                    <Text variant="caption" tone="secondary">
                      Library
                    </Text>
                  </Pressable>
                }
              />
              {templates.length === 0 ? (
                <EmptyState
                  icon="albums-outline"
                  title="No templates loaded"
                  description="Templates appear once the server is reachable."
                  compact
                />
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.row}
                >
                  {templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      onPress={() =>
                        router.push({
                          pathname: '/workflow/[id]',
                          params: { id: template.id },
                        })
                      }
                      onUse={() => openComposer({ templateId: template.id })}
                    />
                  ))}
                </ScrollView>
              )}
            </View>
          </Appear>

          <Appear delay={200}>
            <View>
              <SectionHeader
                title="Agent status"
                subtitle={`${enabledAgents.length} of ${agents.length} enabled · core lineup and specialists`}
                action={
                  <Pressable onPress={() => router.push('/agents')} hitSlop={8}>
                    <Text variant="caption" tone="secondary">
                      Manage
                    </Text>
                  </Pressable>
                }
              />
              {agentsQuery.isLoading ? (
                <ListSkeleton rows={2} />
              ) : agents.length === 0 ? (
                <EmptyState
                  icon="people-outline"
                  title="No agents configured"
                  description="The core lineup is created on first sign-in."
                  compact
                />
              ) : (
                <Card padded={false}>
                  {agents.slice(0, 5).map((agent, index) => (
                    <AgentStatusRow
                      key={agent.id}
                      agent={agent}
                      working={workingAgents.has(agent.name.toLowerCase())}
                      onPress={() => router.push(`/agents/${agent.id}`)}
                      showDivider={index < Math.min(agents.length, 5) - 1}
                    />
                  ))}
                </Card>
              )}
            </View>
          </Appear>

          <Appear delay={240}>
            <View>
              <SectionHeader
                title="Usage overview"
                subtitle="Last 30 days across every provider"
                action={
                  <Pressable onPress={() => router.push('/usage')} hitSlop={8}>
                    <Text variant="caption" tone="secondary">
                      Details
                    </Text>
                  </Pressable>
                }
              />
              <View style={styles.stats}>
                <Stat
                  label="Spend"
                  value={summary ? formatCost(summary.totalCostUsd) : '—'}
                  detail={summary ? `${summary.calls} calls` : 'No usage yet'}
                  icon="card-outline"
                  accent={colors.mint}
                />
                <Stat
                  label="Tokens"
                  value={summary ? formatTokens(summary.totalTokens) : '—'}
                  detail={summary ? '30-day total' : 'Run an objective'}
                  icon="flash-outline"
                  accent={colors.ice}
                />
                <Stat
                  label="Runs"
                  value={String(runs.length)}
                  detail={
                    activeRuns.length > 0
                      ? `${activeRuns.length} active`
                      : `${plural(runs.length, 'run')} total`
                  }
                  icon="layers-outline"
                  accent={colors.amber}
                />
              </View>
              <UsageSparkline summary={summary} onPress={() => router.push('/usage')} />
            </View>
          </Appear>
        </View>
      </ScrollScreen>
    </View>
  );
}

function ProjectCard({
  project,
  onPress,
}: {
  project: Project;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${project.name} project history`}
      style={({ pressed }) => [styles.projectCard, pressed && styles.pressed]}
    >
      <View style={styles.projectTop}>
        <View style={[styles.projectDot, { backgroundColor: project.color }]} />
        <Text variant="caption" tone="faint">
          {project.runCount ?? 0} runs
        </Text>
      </View>
      <Text variant="bodySemibold" numberOfLines={2} style={styles.projectTitle}>
        {project.name}
      </Text>
      <Text variant="caption" tone="tertiary" numberOfLines={2}>
        {project.description ?? 'A shared workspace for related objectives.'}
      </Text>
      <Text variant="caption" tone="faint" style={styles.projectMeta}>
        Updated {relativeTime(project.updatedAt)}
      </Text>
    </Pressable>
  );
}

function TemplateCard({
  template,
  onPress,
  onUse,
}: {
  template: WorkflowTemplate;
  onPress: () => void;
  onUse: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.templateCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={template.name}
    >
      <View style={styles.templateIcon}>
        <Ionicons name="git-branch-outline" size={17} color={colors.ice} />
      </View>
      <Text variant="bodySemibold" numberOfLines={2} style={styles.templateTitle}>
        {template.name}
      </Text>
      <Text variant="caption" tone="tertiary" numberOfLines={2}>
        {template.description}
      </Text>
      <View style={styles.templateFooter}>
        <Text variant="caption" tone="faint">
          {template.category}
        </Text>
        <Button label="Use" size="sm" variant="ghost" onPress={onUse} />
      </View>
    </Pressable>
  );
}

function AgentStatusRow({
  agent,
  working,
  onPress,
  showDivider,
}: {
  agent: Agent;
  working: boolean;
  onPress: () => void;
  showDivider: boolean;
}) {
  const provider = PROVIDER_META[agent.provider];
  const model = getModel(agent.model);
  const statusColor = !agent.enabled
    ? colors.textFaint
    : working
      ? colors.mint
      : colors.textTertiary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${agent.name} settings`}
      style={({ pressed }) => [
        styles.agentRow,
        showDivider && styles.agentDivider,
        pressed && styles.pressed,
      ]}
    >
      <Avatar name={agent.name} accent={agent.accent} size={30} />
      <View style={styles.agentText}>
        <View style={styles.agentNameRow}>
          <Text variant="bodyMedium" numberOfLines={1} style={styles.agentName}>
            {agent.name}
          </Text>
          {working ? (
            <Text variant="caption" tone="mint">
              working
            </Text>
          ) : null}
        </View>
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {ROLE_META[agent.role].label} · {model?.label ?? agent.model}
        </Text>
      </View>
      <View style={styles.agentMeta}>
        <View style={[styles.providerDot, { backgroundColor: provider.accent }]} />
        <Text variant="monoSmall" tone="faint">
          {provider.label}
        </Text>
      </View>
      <StatusDot color={statusColor} active={working} size={5} />
    </Pressable>
  );
}

function UsageSparkline({
  summary,
  onPress,
}: {
  summary: UsageSummary | undefined;
  onPress: () => void;
}) {
  const days = summary?.byDay.slice(-14) ?? [];
  const max = Math.max(...days.map((day) => day.costUsd), 0.0001);

  return (
    <Card onPress={onPress} style={styles.sparkCard}>
      <View style={styles.sparkHeader}>
        <Text variant="caption" tone="tertiary">
          Daily spend
        </Text>
        <View style={styles.sparkLegend}>
          <View style={styles.sparkDot} />
          <Text variant="caption" tone="faint">
            USD
          </Text>
        </View>
      </View>
      {days.length === 0 ? (
        <Text variant="caption" tone="faint">
          Usage appears after the first completed agent call.
        </Text>
      ) : (
        <>
          <View style={styles.sparkBars}>
            {days.map((day) => (
              <View key={day.key} style={styles.sparkBarWrap}>
                <View
                  style={[
                    styles.sparkBar,
                    {
                      height: Math.max(3, (day.costUsd / max) * 44),
                      backgroundColor:
                        day.costUsd === max ? colors.electric : 'rgba(91,140,255,0.38)',
                    },
                  ]}
                />
              </View>
            ))}
          </View>
          <View style={styles.sparkFooter}>
            <Text variant="caption" tone="faint">
              Peak {formatCost(max)}
            </Text>
            <Text variant="caption" tone="faint">
              {summary?.calls ?? 0} calls · {formatTokens(summary?.totalTokens ?? 0)}
            </Text>
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stack: {
    gap: space.xxl,
  },
  composer: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    padding: space.lg,
    gap: space.md,
  },
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  composerLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  objectiveBox: {
    minHeight: 74,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    justifyContent: 'center',
  },
  objectiveText: {
    fontSize: 15,
    lineHeight: 22,
  },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  quickTemplates: {
    flex: 1,
    flexDirection: 'row',
    gap: space.sm,
    overflow: 'hidden',
  },
  quickTemplate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: 150,
  },
  stats: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.md,
  },
  idleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  idleIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleText: {
    flex: 1,
    gap: 2,
  },
  list: {
    gap: space.md,
  },
  activeCard: {
    gap: space.md,
  },
  activeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    gap: space.md,
    paddingRight: space.xl,
  },
  projectCard: {
    width: 210,
    minHeight: 136,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  projectTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  projectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  projectTitle: {
    fontSize: 14,
    lineHeight: 19,
  },
  projectMeta: {
    marginTop: 'auto',
  },
  templateCard: {
    width: 210,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
    minHeight: 170,
  },
  templateIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(168,199,250,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(168,199,250,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateTitle: {
    fontSize: 14,
    lineHeight: 19,
  },
  templateFooter: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 58,
  },
  agentDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  agentText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  agentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  agentName: {
    flexShrink: 1,
  },
  agentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  providerDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  sparkCard: {
    gap: space.md,
  },
  sparkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sparkLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  sparkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(91,140,255,0.6)',
  },
  sparkBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 46,
  },
  sparkBarWrap: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'flex-end',
  },
  sparkBar: {
    borderRadius: 2,
  },
  sparkFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  usageButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
});
