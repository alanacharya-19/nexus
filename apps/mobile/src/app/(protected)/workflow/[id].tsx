import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  APPROVAL_MODE_DESCRIPTIONS,
  APPROVAL_MODE_LABELS,
} from '@nexus/shared';
import { useTemplateMutations, useTemplates } from '@/hooks/queries';
import { relativeTime } from '@/lib/format';
import { colors, radius, space, useAccent } from '@/theme';
import { PageHeader } from '@/components/ui/page-header';
import { ScrollScreen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { SectionHeader } from '@/components/ui/section-header';
import { ListSkeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { toast } from '@/stores/toast';

export default function WorkflowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccent();
  const templatesQuery = useTemplates();
  const { remove } = useTemplateMutations();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const template = templatesQuery.data?.find((entry) => entry.id === id);

  const start = () => {
    if (!template) return;
    router.push({
      pathname: '/run/new',
      params: { templateId: template.id, objective: template.objectiveTemplate },
    });
  };

  const deleteTemplate = async () => {
    if (!template) return;
    try {
      await remove.mutateAsync(template.id);
      setDeleteOpen(false);
      toast('Workflow deleted', `${template.name} was removed from the library.`, 'success');
      router.back();
    } catch {
      setDeleteOpen(false);
    }
  };

  return (
    <View style={styles.flex}>
      <PageHeader
        back
        title={template?.name ?? 'Workflow'}
        subtitle={template ? `${template.category} · reusable playbook` : undefined}
        right={
          template && !template.isBuiltin ? (
            <Button
              label="Delete"
              variant="ghost"
              size="sm"
              onPress={() => setDeleteOpen(true)}
            />
          ) : undefined
        }
      />
      <OfflineBanner />
      <ScrollScreen bottomPadding={insets.bottom + space.xxl}>
        {templatesQuery.isLoading ? (
          <ListSkeleton rows={3} />
        ) : !template ? (
          <ErrorState
            title="Workflow not found"
            message="This playbook may have been deleted. Return to the library to refresh."
            onRetry={() => templatesQuery.refetch()}
          />
        ) : (
          <View style={styles.stack}>
            <Card tone="raised" style={styles.hero}>
              <View style={styles.heroTop}>
                <View
                  style={[
                    styles.icon,
                    { backgroundColor: accent.surface, borderColor: accent.border },
                  ]}
                >
                  <Ionicons name="git-branch-outline" size={20} color={accent.accent} />
                </View>
                <View style={styles.heroText}>
                  <View style={styles.badgeRow}>
                    <Badge label={template.category} tone="ice" />
                    <Badge
                      label={APPROVAL_MODE_LABELS[template.suggestedApprovalMode]}
                      tone="neutral"
                    />
                    <Badge
                      label={template.isBuiltin ? 'Built-in' : 'Custom'}
                      tone={template.isBuiltin ? 'mint' : 'lavender'}
                    />
                  </View>
                  <Text variant="body" tone="secondary">
                    {template.description}
                  </Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Text variant="caption" tone="faint">
                    Approval policy
                  </Text>
                  <Text variant="bodyMedium">
                    {APPROVAL_MODE_LABELS[template.suggestedApprovalMode]}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Text variant="caption" tone="faint">
                    Created
                  </Text>
                  <Text variant="bodyMedium">{relativeTime(template.createdAt)}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text variant="caption" tone="faint">
                    Source
                  </Text>
                  <Text variant="bodyMedium">
                    {template.isBuiltin ? 'NEXUS core' : 'Your workspace'}
                  </Text>
                </View>
              </View>

              <Text variant="caption" tone="tertiary">
                {APPROVAL_MODE_DESCRIPTIONS[template.suggestedApprovalMode]}
              </Text>

              <Button
                label="Start a run with this workflow"
                icon="arrow-forward"
                iconPosition="right"
                fullWidth
                onPress={start}
              />
            </Card>

            <View>
              <SectionHeader
                title="Guidance"
                subtitle="Context the planner receives with every run"
              />
              <Card tone="flat">
                <Text variant="body" tone="secondary">
                  {template.guidance || 'No extra guidance. The objective carries the brief.'}
                </Text>
              </Card>
            </View>

            <View>
              <SectionHeader
                title="Objective template"
                subtitle="Prefilled in the composer; edit the bracketed details before starting"
              />
              <Card style={styles.objectiveCard}>
                <Text variant="mono" style={styles.objective}>
                  {template.objectiveTemplate}
                </Text>
              </Card>
            </View>

            <View>
              <SectionHeader title="How it runs" />
              <Card padded={false}>
                {[
                  {
                    icon: 'map-outline' as const,
                    title: 'Planner builds the route',
                    detail: 'The objective is decomposed into ordered steps with owners.',
                  },
                  {
                    icon: 'construct-outline' as const,
                    title: 'Workers execute',
                    detail: 'Each step produces an artifact that feeds the next one.',
                  },
                  {
                    icon: 'shield-checkmark-outline' as const,
                    title: 'Reviewer audits',
                    detail: `Approval is ${APPROVAL_MODE_LABELS[template.suggestedApprovalMode].toLowerCase()} for this playbook.`,
                  },
                  {
                    icon: 'sparkles-outline' as const,
                    title: 'Polisher delivers',
                    detail: 'The final artifact is versioned and collected in the library.',
                  },
                ].map((step, index) => (
                  <View
                    key={step.title}
                    style={[styles.howRow, index < 3 && styles.howDivider]}
                  >
                    <View style={styles.howIcon}>
                      <Ionicons name={step.icon} size={15} color={accent.accent} />
                    </View>
                    <View style={styles.howText}>
                      <Text variant="bodyMedium">{step.title}</Text>
                      <Text variant="caption" tone="tertiary">
                        {step.detail}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          </View>
        )}
      </ScrollScreen>

      <Sheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${template?.name ?? 'workflow'}?`}
        subtitle="Existing runs keep their captured plan. The playbook will no longer be reusable."
        footer={
          <>
            <Button
              label="Delete workflow"
              variant="danger"
              fullWidth
              loading={remove.isPending}
              onPress={() => void deleteTemplate()}
            />
            <Button
              label="Keep workflow"
              variant="ghost"
              fullWidth
              onPress={() => setDeleteOpen(false)}
            />
          </>
        }
      >
        <Text variant="body" tone="secondary">
          This cannot be undone. Built-in workflows cannot be deleted.
        </Text>
      </Sheet>
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
  hero: {
    gap: space.lg,
    borderColor: colors.borderStrong,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
    gap: space.sm,
    minWidth: 0,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  metaItem: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  objectiveCard: {
    backgroundColor: colors.bgElevated,
  },
  objective: {
    lineHeight: 21,
  },
  howRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
  },
  howDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  howIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howText: {
    flex: 1,
    gap: 2,
  },
});
