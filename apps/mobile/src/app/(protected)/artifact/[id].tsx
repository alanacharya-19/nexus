import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useArtifact } from '@/hooks/queries';
import { api } from '@/lib/api';
import {
  ARTIFACT_EXPORT_OPTIONS,
  prepareArtifactExport,
  type ArtifactExportFormat,
} from '@/lib/artifact-export';
import { shortDate } from '@/lib/format';
import { colors, radius, space } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet } from '@/components/ui/sheet';
import { Markdown } from '@/components/ui/markdown';
import { ListSkeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { toast } from '@/stores/toast';

const KIND_LABEL = {
  document: 'Document',
  code: 'Code',
  deliverable: 'Deliverable',
} as const;

export default function ArtifactScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const artifactQuery = useArtifact(id);
  const artifact = artifactQuery.data;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<ArtifactExportFormat | null>(null);

  const remove = useMutation({
    mutationFn: () => api.deleteArtifact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      queryClient.invalidateQueries({ queryKey: ['run'] });
      toast('Artifact deleted', 'It was removed from the library.', 'success');
      router.back();
    },
    onError: (error) => toast('Could not delete artifact', error.message, 'error'),
  });

  if (artifactQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <PageHeader back title="Artifact" />
        <ScrollScreen bottomPadding={insets.bottom + space.xxl}>
          <ListSkeleton rows={3} />
        </ScrollScreen>
      </View>
    );
  }

  if (artifactQuery.isError || !artifact) {
    return (
      <View style={styles.flex}>
        <PageHeader back title="Artifact" />
        <ScrollScreen bottomPadding={insets.bottom + space.xxl}>
          <ErrorState
            title="Artifact unavailable"
            message={
              artifactQuery.error instanceof Error
                ? artifactQuery.error.message
                : 'This artifact could not be loaded.'
            }
            onRetry={() => artifactQuery.refetch()}
          />
        </ScrollScreen>
      </View>
    );
  }

  const copy = async () => {
    await Clipboard.setStringAsync(artifact.content);
    toast('Copied', 'The full artifact is on your clipboard.', 'success');
  };

  const share = async (format: ArtifactExportFormat) => {
    setExporting(format);
    try {
      const option = ARTIFACT_EXPORT_OPTIONS.find((item) => item.format === format);
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        const text = await api.exportArtifact(artifact.id, format);
        await Clipboard.setStringAsync(text);
        setExportOpen(false);
        toast(
          'Copied instead',
          'Sharing is not available here, so the export is on your clipboard.',
          'success'
        );
        return;
      }

      const file = await prepareArtifactExport(artifact, format);
      setExportOpen(false);
      // Let the sheet finish dismissing before presenting the native share sheet.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await Sharing.shareAsync(file.uri, {
        mimeType: option?.mimeType,
        UTI: option?.uti,
        dialogTitle: `Export ${artifact.name}`,
      });
    } catch (error) {
      toast(
        'Could not export artifact',
        error instanceof Error ? error.message : 'Try again.',
        'error'
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <View style={styles.flex}>
      <PageHeader
        back
        title={artifact.name}
        subtitle={`${KIND_LABEL[artifact.kind]} · v${artifact.version}`}
        right={
          <Button
            label="Copy"
            icon="copy-outline"
            size="sm"
            variant="secondary"
            onPress={() => void copy()}
          />
        }
      />
      <ScrollScreen bottomPadding={insets.bottom + space.xxl}>
        <View style={styles.stack}>
          <Card tone="raised" style={styles.meta}>
            <View style={styles.badges}>
              <Badge label={KIND_LABEL[artifact.kind]} tone="ice" />
              <Badge label={`v${artifact.version}`} tone="neutral" />
              {artifact.agentName ? (
                <Badge label={artifact.agentName} tone="lavender" />
              ) : null}
            </View>
            <View style={styles.metaRow}>
              <Text variant="caption" tone="faint">
                Created {shortDate(artifact.createdAt)}
              </Text>
              <Text variant="monoSmall" tone="faint">
                {artifact.mimeType}
              </Text>
            </View>
          </Card>

          <Card style={styles.content}>
            <Markdown content={artifact.content} />
          </Card>

          <View style={styles.actions}>
            <Button
              label="Export & share"
              icon="share-outline"
              variant="secondary"
              fullWidth
              onPress={() => setExportOpen(true)}
            />
            <Button
              label="Open workspace"
              icon="chatbubbles-outline"
              variant="secondary"
              fullWidth
              onPress={() => router.push(`/workspace/${artifact.runId}`)}
            />
            <Button
              label="Copy markdown"
              icon="copy-outline"
              variant="outline"
              fullWidth
              onPress={() => void copy()}
            />
            <Button
              label="Delete artifact"
              icon="trash-outline"
              variant="danger"
              fullWidth
              onPress={() => setDeleteOpen(true)}
            />
          </View>
        </View>
      </ScrollScreen>

      <Sheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this artifact?"
        subtitle="The run history stays, but this file is removed from the library."
        footer={
          <>
            <Button
              label="Delete"
              variant="danger"
              fullWidth
              loading={remove.isPending}
              onPress={() => remove.mutate()}
            />
            <Button
              label="Keep artifact"
              variant="ghost"
              fullWidth
              onPress={() => setDeleteOpen(false)}
            />
          </>
        }
      >
        <View style={styles.deleteRow}>
          <View style={styles.deleteIcon}>
            <Ionicons name="document-text-outline" size={16} color={colors.danger} />
          </View>
          <Text variant="body" tone="secondary" style={styles.flexText}>
            {artifact.name}
          </Text>
        </View>
      </Sheet>

      <Sheet
        visible={exportOpen}
        onClose={() => {
          if (exporting === null) setExportOpen(false);
        }}
        title="Export artifact"
        subtitle="Pick a format, then send it anywhere."
        footer={
          <Button
            label="Cancel"
            variant="ghost"
            fullWidth
            disabled={exporting !== null}
            onPress={() => setExportOpen(false)}
          />
        }
      >
        <View style={styles.exportList}>
          {ARTIFACT_EXPORT_OPTIONS.map((option) => {
            const busy = exporting === option.format;
            const icon =
              option.format === 'json' ? 'code-slash-outline' : 'document-text-outline';
            return (
              <Pressable
                key={option.format}
                onPress={() => void share(option.format)}
                disabled={exporting !== null}
                accessibilityRole="button"
                accessibilityLabel={`Export as ${option.label}`}
                accessibilityState={{ disabled: exporting !== null, busy }}
                style={({ pressed }) => [
                  styles.exportRow,
                  pressed && styles.exportPressed,
                ]}
              >
                <View style={styles.exportIcon}>
                  <Ionicons name={icon} size={16} color={colors.ice} />
                </View>
                <View style={styles.exportText}>
                  <Text variant="bodyMedium">{option.label}</Text>
                  <Text variant="caption" tone="tertiary">
                    {option.description}
                  </Text>
                </View>
                {busy ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <Ionicons name="share-outline" size={16} color={colors.textTertiary} />
                )}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
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
    gap: space.lg,
  },
  meta: {
    gap: space.md,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  content: {
    paddingVertical: space.xl,
  },
  actions: {
    gap: space.sm,
    marginTop: space.sm,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  deleteIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportList: {
    gap: space.sm,
  },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  exportPressed: {
    opacity: 0.72,
  },
  exportIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(168,199,250,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(168,199,250,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportText: {
    flex: 1,
    gap: 2,
  },
});
