import { useDeferredValue, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Project, RunStatus } from '@nexus/shared';
import { RUN_STATUS_LABELS } from '@nexus/shared';
import { useProjectMutations, useProjects, useRuns } from '@/hooks/queries';
import { usePreferencesStore } from '@/stores/preferences';
import { colors, space, useAccent } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Chip } from '@/components/ui/chip';
import { Segmented } from '@/components/ui/segmented';
import { SectionHeader } from '@/components/ui/section-header';
import { Stat } from '@/components/ui/stat';
import { ListSkeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { RunCard } from '@/components/runs/run-card';
import {
  ProjectSheet,
  type ProjectFormValues,
} from '@/components/projects/project-sheets';
import { Appear } from '@/components/ui/animated';
import { plural } from '@/lib/format';
import { toast } from '@/stores/toast';

type Filter = 'all' | RunStatus;

const ACTIVE_STATUSES: RunStatus[] = ['running', 'awaiting_approval', 'paused', 'queued'];

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  ...ACTIVE_STATUSES.map((status) => ({
    label: RUN_STATUS_LABELS[status],
    value: status,
  })),
  { label: 'Completed', value: 'completed' as RunStatus },
  { label: 'Failed', value: 'failed' as RunStatus },
  { label: 'Cancelled', value: 'cancelled' as RunStatus },
];

export default function RunsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccent();
  const compactLists = usePreferencesStore((state) => state.compactLists);
  const params = useLocalSearchParams<{ projectId?: string }>();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [projectOverride, setProjectOverride] = useState<string | null | undefined>(
    undefined
  );
  const deferredSearch = useDeferredValue(search.trim());

  const projectId =
    projectOverride !== undefined ? projectOverride : (params.projectId ?? null);
  const setProjectId = (value: string | null) => setProjectOverride(value);

  const projectsQuery = useProjects();
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  const { create: createProject, update: updateProject, remove: removeProject } =
    useProjectMutations();
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerStartsCreating, setManagerStartsCreating] = useState(false);

  const resetProjectMutations = () => {
    createProject.reset();
    updateProject.reset();
    removeProject.reset();
  };

  const openProjects = (startCreating = false) => {
    resetProjectMutations();
    setManagerStartsCreating(startCreating);
    setManagerOpen(true);
  };

  const closeProjects = () => {
    resetProjectMutations();
    setManagerOpen(false);
  };

  const createProjectFromForm = async (values: ProjectFormValues) => {
    createProject.reset();
    try {
      const { project } = await createProject.mutateAsync(values);
      toast('Project created', `${project.name} is ready for new conversations.`, 'success');
      setProjectId(project.id);
      return true;
    } catch {
      // The mutation error is shown inline in the sheet.
      return false;
    }
  };

  const updateProjectFromForm = async (project: Project, values: ProjectFormValues) => {
    updateProject.reset();
    try {
      await updateProject.mutateAsync({ id: project.id, input: values });
      toast('Project updated', `${values.name} is up to date.`, 'success');
      return true;
    } catch {
      return false;
    }
  };

  const deleteProjectFromForm = async (project: Project) => {
    removeProject.reset();
    try {
      await removeProject.mutateAsync(project.id);
      if (projectId === project.id) setProjectId(null);
      toast(
        'Project deleted',
        `${project.name} was removed. Its conversations were kept.`,
        'success'
      );
      return true;
    } catch {
      // The mutation hook surfaces the failure with a toast.
      return false;
    }
  };

  const projectError =
    createProject.error instanceof Error
      ? createProject.error.message
      : updateProject.error instanceof Error
        ? updateProject.error.message
        : removeProject.error instanceof Error
          ? removeProject.error.message
          : null;

  const runsQuery = useRuns({
    status: filter === 'all' ? undefined : filter,
    search: deferredSearch || undefined,
    projectId: projectId ?? undefined,
  });
  const runs = useMemo(() => runsQuery.data?.runs ?? [], [runsQuery.data?.runs]);

  const activeCount = useMemo(
    () => runs.filter((run) => ACTIVE_STATUSES.includes(run.status)).length,
    [runs]
  );
  const completedCount = useMemo(
    () => runs.filter((run) => run.status === 'completed').length,
    [runs]
  );
  const deliverableCount = useMemo(
    () => runs.filter((run) => Boolean(run.finalArtifactId)).length,
    [runs]
  );

  const selectedProject = projects.find((project) => project.id === projectId);
  const hasFilters = filter !== 'all' || deferredSearch.length > 0 || projectId !== null;

  const clearFilters = () => {
    setFilter('all');
    setSearch('');
    setProjectId(null);
  };

  return (
    <View style={styles.flex}>
      <PageHeader
        title="Projects"
        subtitle={
          runsQuery.isLoading
            ? 'Loading your workspace…'
            : `${plural(runs.length, 'conversation')}${activeCount > 0 ? ` · ${activeCount} active` : ''}`
        }
        right={
          <>
            <IconButton
              icon="folder-outline"
              variant="surface"
              onPress={() => openProjects()}
              accessibilityLabel="Manage projects"
            />
            <IconButton
              icon="add"
              variant="surface"
              onPress={() => router.push('/run/new')}
              accessibilityLabel="New task"
            />
          </>
        }
      />
      <OfflineBanner />
      <ScrollScreen
        refreshing={runsQuery.isFetching || projectsQuery.isFetching}
        onRefresh={() => {
          void runsQuery.refetch();
          void projectsQuery.refetch();
        }}
        bottomPadding={insets.bottom + 110}
      >
        <View style={styles.stack}>
          <Appear>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder="Search titles, objectives, and projects"
              leftIcon="search-outline"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              rightElement={
                search.length > 0 ? (
                  <IconButton
                    icon="close-circle"
                    size={16}
                    tone="muted"
                    onPress={() => setSearch('')}
                    accessibilityLabel="Clear search"
                  />
                ) : undefined
              }
            />
          </Appear>

          <Appear delay={30}>
            <View>
              <View style={styles.filterHeader}>
                <Text variant="label">Project</Text>
                <View style={styles.filterActions}>
                  {projectId ? (
                    <Pressable onPress={() => setProjectId(null)} hitSlop={8}>
                      <Text variant="caption" tone="secondary">
                        Reset
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => openProjects()} hitSlop={8}>
                    <Text variant="caption" tone="secondary">
                      Manage
                    </Text>
                  </Pressable>
                </View>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                <Chip
                  label="All projects"
                  icon="layers-outline"
                  selected={projectId === null}
                  onPress={() => setProjectId(null)}
                />
                {projects.map((project) => (
                  <Chip
                    key={project.id}
                    label={project.name}
                    icon="folder-outline"
                    selected={projectId === project.id}
                    onPress={() =>
                      setProjectId(projectId === project.id ? null : project.id)
                    }
                  />
                ))}
                <Chip
                  label="New project"
                  icon="add-outline"
                  onPress={() => openProjects(true)}
                />
              </ScrollView>
            </View>
          </Appear>

          <Appear delay={40}>
            <Segmented options={FILTERS} value={filter} onChange={setFilter} scrollable />
          </Appear>

          {runs.length > 0 ? (
            <Appear delay={70}>
              <View style={styles.stats}>
                <Stat
                  label="In flight"
                  value={String(activeCount)}
                  detail={activeCount === 0 ? 'Lineup idle' : 'Live now'}
                  icon="pulse-outline"
                  accent={accent.accent}
                />
                <Stat
                  label="Completed"
                  value={String(completedCount)}
                  detail={plural(completedCount, 'run')}
                  icon="checkmark-circle-outline"
                  accent={colors.mint}
                />
                <Stat
                  label="Deliverables"
                  value={String(deliverableCount)}
                  detail="Final artifacts"
                  icon="trophy-outline"
                  accent={colors.amber}
                />
              </View>
            </Appear>
          ) : null}

          {runsQuery.isLoading ? (
            <ListSkeleton rows={4} />
          ) : runsQuery.isError ? (
            <ErrorState
              message={runsQuery.error.message}
              onRetry={() => runsQuery.refetch()}
            />
          ) : runs.length === 0 ? (
            <EmptyState
              icon={hasFilters ? 'search-outline' : 'layers-outline'}
              title={
                hasFilters
                  ? 'No matching conversations'
                  : selectedProject
                    ? `${selectedProject.name} is empty`
                    : 'No conversations yet'
              }
              description={
                hasFilters
                  ? 'Try a different search, status, or project filter.'
                  : 'Give your agents an objective and the full pipeline will appear here.'
              }
              actionLabel={hasFilters ? 'Clear filters' : 'Start a task'}
              onAction={hasFilters ? clearFilters : () => router.push('/run/new')}
            />
          ) : (
            <View>
              <SectionHeader
                title={
                  filter === 'all'
                    ? selectedProject?.name ?? 'All conversations'
                    : RUN_STATUS_LABELS[filter]
                }
                subtitle={
                  selectedProject
                    ? selectedProject.description ?? 'Project history, newest first'
                    : 'Newest activity first'
                }
                action={
                  hasFilters ? (
                    <Pressable onPress={clearFilters} hitSlop={8}>
                      <Text variant="caption" tone="secondary">
                        Clear
                      </Text>
                    </Pressable>
                  ) : undefined
                }
              />
              <View style={[styles.list, compactLists && styles.listCompact]}>
                {runs.map((run) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    compact={compactLists}
                    onPress={() => router.push(`/workspace/${run.id}`)}
                    onOpenArtifact={
                      run.finalArtifactId
                        ? () => router.push(`/artifact/${run.finalArtifactId}`)
                        : undefined
                    }
                  />
                ))}
              </View>
              <View style={styles.footerNote}>
                <Ionicons name="git-branch-outline" size={13} color={colors.textFaint} />
                <Text variant="caption" tone="faint" style={styles.footerText}>
                  Open any conversation to continue steering the agents, review the plan, and
                  collect final artifacts.
                </Text>
              </View>
            </View>
          )}
        </View>
      </ScrollScreen>

      <ProjectSheet
        visible={managerOpen}
        createOnOpen={managerStartsCreating}
        projects={projects}
        busy={createProject.isPending || updateProject.isPending || removeProject.isPending}
        error={projectError}
        onClose={closeProjects}
        onCreate={createProjectFromForm}
        onUpdate={updateProjectFromForm}
        onDelete={deleteProjectFromForm}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stack: {
    gap: space.lg,
  },
  filterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  filterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  chipRow: {
    gap: space.sm,
    paddingRight: space.xl,
  },
  stats: {
    flexDirection: 'row',
    gap: space.sm,
  },
  list: {
    gap: space.md,
  },
  listCompact: {
    gap: space.sm,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingTop: space.lg,
  },
  footerText: {
    flex: 1,
    lineHeight: 17,
  },
});
