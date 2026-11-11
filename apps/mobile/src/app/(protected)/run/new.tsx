import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  APPROVAL_MODE_DESCRIPTIONS,
  APPROVAL_MODE_LABELS,
  ROLE_META,
  getModel,
} from '@nexus/shared';
import type { Agent, ApprovalMode } from '@nexus/shared';
import { useAgents, useCreateRun, useProjects, useTemplates } from '@/hooks/queries';
import { usePersistentDraft } from '@/hooks/use-persistent-draft';
import { colors, radius, space, useAccent } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { Appear } from '@/components/ui/animated';
import { toast } from '@/stores/toast';

const APPROVAL_OPTIONS: ApprovalMode[] = ['key', 'always', 'auto'];

const ROLE_ORDER: Agent['role'][] = ['planner', 'worker', 'reviewer', 'polisher', 'custom'];

export default function NewRunScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccent();
  const params = useLocalSearchParams<{ templateId?: string; objective?: string }>();

  const templatesQuery = useTemplates();
  const projectsQuery = useProjects();
  const agentsQuery = useAgents();
  const createRun = useCreateRun();

  const objectiveDraft = usePersistentDraft(
    'nexus.draft.new-run.objective',
    params.objective ?? ''
  );
  const titleDraft = usePersistentDraft('nexus.draft.new-run.title');

  const [templateId, setTemplateId] = useState<string | null>(params.templateId ?? null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [approvalOverride, setApprovalOverride] = useState<ApprovalMode | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const templates = templatesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const enabledAgents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => agent.enabled),
    [agentsQuery.data]
  );
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const objective =
    objectiveDraft.value.length > 0
      ? objectiveDraft.value
      : selectedTemplate?.objectiveTemplate ?? '';
  const approvalMode =
    approvalOverride ?? selectedTemplate?.suggestedApprovalMode ?? 'key';

  const lineup = useMemo(
    () =>
      [...enabledAgents]
        .filter((agent) => !excluded.includes(agent.id))
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)),
    [enabledAgents, excluded]
  );

  const toggleAgent = (agentId: string) => {
    setExcluded((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId]
    );
  };

  const applyTemplate = (id: string | null) => {
    setTemplateId(id);
    setApprovalOverride(null);
    if (id === null) return;
    const template = templates.find((entry) => entry.id === id);
    if (template) {
      objectiveDraft.setValue(template.objectiveTemplate);
      setApprovalOverride(template.suggestedApprovalMode);
    }
  };

  const clearDraft = () => {
    void objectiveDraft.clear();
    void titleDraft.clear();
    setTemplateId(null);
    setProjectId(null);
    setApprovalOverride(null);
    setExcluded([]);
    setError(null);
  };

  const submit = async () => {
    const cleanObjective = objective.trim();
    if (cleanObjective.length < 12) {
      setError('Describe the objective in at least 12 characters.');
      return;
    }
    if (cleanObjective.length > 20_000) {
      setError('The objective is too long. Keep it under 20,000 characters.');
      return;
    }
    if (titleDraft.value.trim().length > 120) {
      setError('The title must be 120 characters or fewer.');
      return;
    }
    if (enabledAgents.length === 0) {
      setError('No enabled agents. Enable at least one agent in the Agents tab.');
      return;
    }
    if (lineup.length === 0) {
      setError('Select at least one agent for this run.');
      return;
    }
    setError(null);
    try {
      const result = await createRun.mutateAsync({
        objective: cleanObjective,
        title: titleDraft.value.trim() || undefined,
        projectId,
        templateId,
        approvalMode,
        agents: lineup.map((agent) => ({ agentId: agent.id })),
      });
      await objectiveDraft.clear();
      await titleDraft.clear();
      toast('Run started', 'Your agents are planning the objective now.', 'success');
      router.replace(`/workspace/${result.run.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the run.');
    }
  };

  const hasDraft =
    objectiveDraft.value.length > 0 ||
    titleDraft.value.length > 0 ||
    templateId !== null ||
    projectId !== null;

  return (
    <View style={styles.flex}>
      <PageHeader
        back
        title="New task"
        subtitle="One objective. A full specialist pipeline."
        right={
          hasDraft ? (
            <Button label="Clear" size="sm" variant="ghost" onPress={clearDraft} />
          ) : undefined
        }
      />
      <OfflineBanner />
      <ScrollScreen bottomPadding={insets.bottom + 40}>
        <View style={styles.stack}>
          <Appear>
            <View>
              <SectionHeader
                title="Objective"
                subtitle="What should the agents actually deliver?"
              />
              <Input
                value={objective}
                onChangeText={objectiveDraft.setValue}
                placeholder="Describe the outcome you need — a launch brief, an architecture review, a working prototype…"
                multiline
                hint={
                  objectiveDraft.hydrated
                    ? `${objective.trim().length.toLocaleString()} / 20,000 characters · draft saved on device`
                    : 'Restoring your draft…'
                }
                containerStyle={styles.objective}
              />
            </View>
          </Appear>

          <Appear delay={30}>
            <Input
              label="Title"
              value={titleDraft.value}
              onChangeText={titleDraft.setValue}
              placeholder="Optional — generated from the objective"
              maxLength={120}
              hint="Shown in the project history and workspace header."
            />
          </Appear>

          {templates.length > 0 ? (
            <Appear delay={60}>
              <View>
                <SectionHeader
                  title="Workflow"
                  subtitle="Start from a proven playbook, or write your own"
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  <Chip
                    label="None"
                    selected={templateId === null}
                    onPress={() => applyTemplate(null)}
                  />
                  {templates.map((template) => (
                    <Chip
                      key={template.id}
                      label={template.name}
                      selected={templateId === template.id}
                      onPress={() => applyTemplate(template.id)}
                    />
                  ))}
                </ScrollView>
                {selectedTemplate ? (
                  <Card tone="flat" style={styles.templateNote}>
                    <Text variant="caption" tone="tertiary">
                      {selectedTemplate.guidance}
                    </Text>
                    <Button
                      label="View workflow"
                      variant="ghost"
                      size="sm"
                      icon="arrow-forward"
                      iconPosition="right"
                      onPress={() =>
                        router.push({
                          pathname: '/workflow/[id]',
                          params: { id: selectedTemplate.id },
                        })
                      }
                      style={styles.templateLink}
                    />
                  </Card>
                ) : null}
              </View>
            </Appear>
          ) : null}

          {projects.length > 0 ? (
            <Appear delay={90}>
              <View>
                <SectionHeader title="Project" subtitle="Optional grouping for this work" />
                <View style={styles.chipWrap}>
                  <Chip
                    label="No project"
                    selected={projectId === null}
                    onPress={() => setProjectId(null)}
                  />
                  {projects.map((project) => (
                    <Chip
                      key={project.id}
                      label={project.name}
                      selected={projectId === project.id}
                      onPress={() => setProjectId(project.id)}
                    />
                  ))}
                </View>
              </View>
            </Appear>
          ) : null}

          <Appear delay={120}>
            <View>
              <SectionHeader
                title="Approval policy"
                subtitle="Decide where you want to review the work"
              />
              <View style={styles.approvalList}>
                {APPROVAL_OPTIONS.map((option) => {
                  const selected = approvalMode === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setApprovalOverride(option)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [
                        styles.approval,
                        selected && styles.approvalSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.approvalTop}>
                        <Text variant="bodyMedium" tone={selected ? 'primary' : 'secondary'}>
                          {APPROVAL_MODE_LABELS[option]}
                        </Text>
                        <View style={[styles.radio, selected && styles.radioSelected]}>
                          {selected ? <View style={styles.radioDot} /> : null}
                        </View>
                      </View>
                      <Text variant="caption" tone="tertiary">
                        {APPROVAL_MODE_DESCRIPTIONS[option]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Appear>

          <Appear delay={150}>
            <View>
              <SectionHeader
                title="Lineup"
                subtitle={`${lineup.length} of ${enabledAgents.length} enabled agents selected · tap to change`}
                action={
                  excluded.length > 0 ? (
                    <Pressable onPress={() => setExcluded([])} hitSlop={8}>
                      <Text variant="caption" tone="secondary">
                        Select all
                      </Text>
                    </Pressable>
                  ) : undefined
                }
              />
              {agentsQuery.isLoading ? (
                <Text variant="caption" tone="faint">
                  Loading agents…
                </Text>
              ) : enabledAgents.length === 0 ? (
                <EmptyState
                  icon="people-outline"
                  title="No enabled agents"
                  description="Enable an agent in the Agents tab before starting a run."
                  actionLabel="Open agents"
                  onAction={() => router.push('/agents')}
                  compact
                />
              ) : (
                <Card padded={false}>
                  {[...enabledAgents]
                    .sort(
                      (a, b) =>
                        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
                    )
                    .map((agent, index) => {
                      const model = getModel(agent.model);
                      const selected = !excluded.includes(agent.id);
                      return (
                        <Pressable
                          key={agent.id}
                          onPress={() => toggleAgent(agent.id)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={`${agent.name}, ${selected ? 'included' : 'excluded'}`}
                          style={({ pressed }) => [
                            styles.agentRow,
                            index < enabledAgents.length - 1 && styles.agentDivider,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Avatar name={agent.name} accent={agent.accent} size={32} />
                          <View style={styles.agentText}>
                            <Text
                              variant="bodyMedium"
                              tone={selected ? 'primary' : 'tertiary'}
                              numberOfLines={1}
                            >
                              {agent.name}
                            </Text>
                            <Text variant="caption" tone="faint" numberOfLines={1}>
                              {ROLE_META[agent.role].label} · {model?.label ?? agent.model}
                            </Text>
                          </View>
                          <Ionicons
                            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                            size={18}
                            color={selected ? accent.accent : colors.textFaint}
                          />
                        </Pressable>
                      );
                    })}
                </Card>
              )}
              <Text variant="caption" tone="faint" style={styles.lineupNote}>
                The lineup is frozen when the run starts, so later agent edits never change
                work already in progress.
              </Text>
            </View>
          </Appear>

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={14} color={colors.danger} />
              <Text variant="caption" tone="danger" style={styles.errorText}>
                {error}
              </Text>
            </View>
          ) : null}

          <Button
            label="Start run"
            icon="arrow-forward"
            iconPosition="right"
            size="lg"
            fullWidth
            loading={createRun.isPending}
            onPress={() => void submit()}
          />
        </View>
      </ScrollScreen>
    </View>
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
  objective: {
    marginTop: space.xs,
  },
  chipRow: {
    gap: space.sm,
    paddingRight: space.xl,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  templateNote: {
    marginTop: space.md,
    backgroundColor: colors.bgElevated,
    gap: space.sm,
  },
  templateLink: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
  },
  approvalList: {
    gap: space.sm,
  },
  approval: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: space.md,
    gap: space.xs,
  },
  approvalSelected: {
    borderColor: 'rgba(168,199,250,0.4)',
    backgroundColor: 'rgba(168,199,250,0.06)',
  },
  approvalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.ice,
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.ice,
  },
  pressed: {
    opacity: 0.75,
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
    gap: 1,
    minWidth: 0,
  },
  lineupNote: {
    marginTop: space.sm,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  errorText: {
    flex: 1,
  },
});
