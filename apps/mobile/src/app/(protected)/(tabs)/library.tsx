import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  APPROVAL_MODE_LABELS,
  TEMPLATE_CATEGORIES,
} from '@nexus/shared';
import type { ApprovalMode, Artifact, WorkflowTemplate } from '@nexus/shared';
import { useArtifacts, useTemplateMutations, useTemplates } from '@/hooks/queries';
import { relativeTime } from '@/lib/format';
import { colors, radius, space } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { SectionHeader } from '@/components/ui/section-header';
import { ListSkeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { toast } from '@/stores/toast';

type Tab = 'templates' | 'artifacts';

const ARTIFACT_KIND_LABEL: Record<Artifact['kind'], string> = {
  document: 'Document',
  code: 'Code',
  deliverable: 'Deliverable',
};

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('templates');
  const [category, setCategory] = useState<string>('All');
  const [createOpen, setCreateOpen] = useState(false);

  const templatesQuery = useTemplates();
  const artifactsQuery = useArtifacts(50);

  const categories = useMemo(() => {
    const extra = (templatesQuery.data ?? [])
      .map((template) => template.category)
      .filter((item) => !(TEMPLATE_CATEGORIES as readonly string[]).includes(item));
    return [...TEMPLATE_CATEGORIES, ...Array.from(new Set(extra))];
  }, [templatesQuery.data]);

  const templates = useMemo(() => {
    const all = templatesQuery.data ?? [];
    if (category === 'All') return all;
    return all.filter((template) => template.category === category);
  }, [templatesQuery.data, category]);

  const artifacts = artifactsQuery.data ?? [];

  return (
    <View style={styles.flex}>
      <PageHeader
        title="Library"
        subtitle="Reusable playbooks and everything your agents have produced"
        right={
          tab === 'templates' ? (
            <IconButton
              icon="add"
              variant="surface"
              onPress={() => setCreateOpen(true)}
              accessibilityLabel="Create template"
            />
          ) : undefined
        }
      />
      <OfflineBanner />
      <ScrollScreen
        refreshing={templatesQuery.isFetching || artifactsQuery.isFetching}
        onRefresh={() => {
          void templatesQuery.refetch();
          void artifactsQuery.refetch();
        }}
        bottomPadding={insets.bottom + 110}
      >
        <View style={styles.stack}>
          <Segmented
            options={[
              { label: 'Templates', value: 'templates' },
              { label: 'Artifacts', value: 'artifacts' },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === 'templates' ? (
            <TemplatesTab
              templates={templates}
              categories={categories}
              category={category}
              onCategory={setCategory}
              loading={templatesQuery.isLoading}
              error={templatesQuery.isError ? templatesQuery.error.message : null}
              onRetry={() => templatesQuery.refetch()}
              onUse={(template) =>
                router.push({
                  pathname: '/workflow/[id]',
                  params: { id: template.id },
                })
              }
              onStart={(template) =>
                router.push({
                  pathname: '/run/new',
                  params: { templateId: template.id, objective: template.objectiveTemplate },
                })
              }
              onCreate={() => setCreateOpen(true)}
            />
          ) : (
            <ArtifactsTab
              artifacts={artifacts}
              loading={artifactsQuery.isLoading}
              error={artifactsQuery.isError ? artifactsQuery.error.message : null}
              onRetry={() => artifactsQuery.refetch()}
              onOpen={(artifact) => router.push(`/artifact/${artifact.id}`)}
              onStart={() => router.push('/run/new')}
            />
          )}
        </View>
      </ScrollScreen>

      <CreateTemplateSheet visible={createOpen} onClose={() => setCreateOpen(false)} />
    </View>
  );
}

function TemplatesTab({
  templates,
  categories,
  category,
  onCategory,
  loading,
  error,
  onRetry,
  onUse,
  onStart,
  onCreate,
}: {
  templates: WorkflowTemplate[];
  categories: readonly string[];
  category: string;
  onCategory: (value: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onUse: (template: WorkflowTemplate) => void;
  onStart: (template: WorkflowTemplate) => void;
  onCreate: () => void;
}) {
  if (loading) return <ListSkeleton rows={4} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  return (
    <View style={styles.stack}>
      <ScrollViewRow>
        {categories.map((item) => (
          <Chip
            key={item}
            label={item}
            selected={category === item}
            onPress={() => onCategory(item)}
          />
        ))}
      </ScrollViewRow>

      {templates.length === 0 ? (
        <EmptyState
          icon="albums-outline"
          title="No templates in this category"
          description="Create a reusable playbook so your next run starts with the right context."
          actionLabel="Create template"
          onAction={onCreate}
        />
      ) : (
        <View style={styles.list}>
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onPress={() => onUse(template)}
              onStart={() => onStart(template)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function TemplateCard({
  template,
  onPress,
  onStart,
}: {
  template: WorkflowTemplate;
  onPress: () => void;
  onStart: () => void;
}) {
  return (
    <View style={styles.templateCard}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${template.name} details`}
        style={({ pressed }) => [styles.templateBody, pressed && styles.pressed]}
      >
        <View style={styles.templateHeader}>
          <View style={styles.templateTitleWrap}>
            <Text variant="bodySemibold" numberOfLines={2}>
              {template.name}
            </Text>
            <Text variant="caption" tone="tertiary" numberOfLines={3}>
              {template.description}
            </Text>
          </View>
          <View style={styles.templateArrow}>
            <Ionicons name="arrow-forward" size={15} color={colors.textTertiary} />
          </View>
        </View>
        <View style={styles.templateMeta}>
          <Badge label={template.category} tone="ice" />
          <Badge
            label={APPROVAL_MODE_LABELS[template.suggestedApprovalMode]}
            tone="neutral"
          />
          {template.isBuiltin ? null : <Badge label="Custom" tone="lavender" />}
        </View>
      </Pressable>
      <View style={styles.templateFooter}>
        <Text variant="caption" tone="faint" numberOfLines={1} style={styles.flexText}>
          {template.guidance}
        </Text>
        <Button label="Use" size="sm" variant="secondary" onPress={onStart} />
      </View>
    </View>
  );
}

function ArtifactsTab({
  artifacts,
  loading,
  error,
  onRetry,
  onOpen,
  onStart,
}: {
  artifacts: Artifact[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (artifact: Artifact) => void;
  onStart: () => void;
}) {
  if (loading) return <ListSkeleton rows={4} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (artifacts.length === 0) {
    return (
      <EmptyState
        icon="document-text-outline"
        title="No artifacts yet"
        description="Every deliverable, draft, and review your agents produce is collected here."
        actionLabel="Start a run"
        onAction={onStart}
      />
    );
  }

  return (
    <View>
      <SectionHeader title="All artifacts" subtitle="Newest first" />
      <View style={styles.list}>
        {artifacts.map((artifact) => (
          <Card
            key={artifact.id}
            onPress={() => onOpen(artifact)}
            style={styles.artifactCard}
            accessibilityLabel={artifact.name}
          >
            <View style={styles.artifactIcon}>
              <Ionicons
                name={
                  artifact.kind === 'code'
                    ? 'code-slash-outline'
                    : artifact.kind === 'deliverable'
                      ? 'trophy-outline'
                      : 'document-text-outline'
                }
                size={16}
                color={colors.ice}
              />
            </View>
            <View style={styles.artifactText}>
              <Text variant="bodyMedium" numberOfLines={2}>
                {artifact.name}
              </Text>
              <Text variant="caption" tone="tertiary" numberOfLines={1}>
                {ARTIFACT_KIND_LABEL[artifact.kind]}
                {artifact.agentName ? ` · ${artifact.agentName}` : ''} · v
                {artifact.version}
              </Text>
            </View>
            <Text variant="caption" tone="faint">
              {relativeTime(artifact.createdAt)}
            </Text>
          </Card>
        ))}
      </View>
    </View>
  );
}

function ScrollViewRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

function CreateTemplateSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { create } = useTemplateMutations();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Custom');
  const [objective, setObjective] = useState('');
  const [guidance, setGuidance] = useState('');
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('key');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setDescription('');
    setCategory('Custom');
    setObjective('');
    setGuidance('');
    setApprovalMode('key');
    setError(null);
  };

  const submit = async () => {
    if (name.trim().length < 2) {
      setError('Give the template a name.');
      return;
    }
    if (objective.trim().length < 10) {
      setError('Add an objective prompt that can be reused.');
      return;
    }
    setError(null);
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || 'A reusable NEXUS playbook.',
        category: category.trim() || 'Custom',
        icon: 'sparkles',
        objectiveTemplate: objective.trim(),
        guidance: guidance.trim(),
        suggestedApprovalMode: approvalMode,
      });
      toast('Template created', 'It is ready to use for your next run.', 'success');
      reset();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the template.');
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="New template"
      subtitle="Capture a repeatable objective, context, and approval policy."
      footer={
        <>
          <Button
            label="Create template"
            fullWidth
            loading={create.isPending}
            onPress={() => void submit()}
          />
          <Button
            label="Cancel"
            variant="ghost"
            fullWidth
            onPress={() => {
              reset();
              onClose();
            }}
          />
        </>
      }
    >
      <Input label="Name" value={name} onChangeText={setName} placeholder="Quarterly board memo" />
      <Input
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="What this playbook produces"
      />
      <Input
        label="Category"
        value={category}
        onChangeText={setCategory}
        placeholder="Strategy"
      />
      <Input
        label="Objective template"
        value={objective}
        onChangeText={setObjective}
        placeholder="Write a complete board memo for [COMPANY] covering…"
        multiline
        hint="Leave placeholders in [BRACKETS] for the details you will fill in each time."
      />
      <Input
        label="Guidance"
        value={guidance}
        onChangeText={setGuidance}
        placeholder="Constraints, tone, or quality bar the agents must respect"
        multiline
      />
      <View style={styles.sheetField}>
        <Text variant="label">Suggested approval</Text>
        <Segmented
          options={[
            { label: 'Key stages', value: 'key' },
            { label: 'Every stage', value: 'always' },
            { label: 'Autonomous', value: 'auto' },
          ]}
          value={approvalMode}
          onChange={setApprovalMode}
          size="sm"
        />
      </View>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
    </Sheet>
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
  list: {
    gap: space.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  templateCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  templateBody: {
    gap: space.md,
  },
  templateFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  flexText: {
    flex: 1,
  },
  pressed: {
    opacity: 0.72,
  },
  templateHeader: {
    flexDirection: 'row',
    gap: space.md,
  },
  templateTitleWrap: {
    flex: 1,
    gap: space.xs,
  },
  templateArrow: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  templateMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  artifactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  artifactIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(168,199,250,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(168,199,250,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artifactText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  sheetField: {
    gap: space.sm,
  },
});
