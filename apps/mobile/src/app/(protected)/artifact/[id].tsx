import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useArtifact } from '@/hooks/queries';
import { api } from '@/lib/api';
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
});
