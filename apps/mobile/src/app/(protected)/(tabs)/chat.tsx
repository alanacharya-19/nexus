import { useDeferredValue, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  PROVIDER_META,
  PROVIDERS,
  getModel,
  modelsByProvider,
  type Conversation,
  type ProviderId,
} from '@nexus/shared';
import {
  useAiPreferences,
  useConversationMutations,
  useConversations,
  useProjects,
} from '@/hooks/queries';
import { colors, space, useAccent } from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { SectionHeader } from '@/components/ui/section-header';
import { ListSkeleton } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { Appear } from '@/components/ui/animated';
import { relativeTime, plural } from '@/lib/format';
import { toast } from '@/stores/toast';

export default function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccent();

  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [newProjectId, setNewProjectId] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>('openai');
  const [model, setModel] = useState('');

  const deferredSearch = useDeferredValue(search.trim());

  const conversationsQuery = useConversations({
    search: deferredSearch || undefined,
    projectId: projectId ?? undefined,
  });
  const projectsQuery = useProjects();
  const preferencesQuery = useAiPreferences();
  const { create } = useConversationMutations();

  const conversations = useMemo(
    () => conversationsQuery.data?.conversations ?? [],
    [conversationsQuery.data?.conversations]
  );
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const preferences = preferencesQuery.data;

  const providerModels = useMemo(() => modelsByProvider(provider), [provider]);
  const selectedModel = getModel(model);

  const openNew = () => {
    const preferredProvider = preferences?.defaultProvider ?? 'openai';
    const preferredModel =
      preferences?.defaultModel && getModel(preferences.defaultModel)?.provider === preferredProvider
        ? preferences.defaultModel
        : modelsByProvider(preferredProvider)[0]?.id ?? '';
    setTitle('');
    setNewProjectId(projectId);
    setProvider(preferredProvider);
    setModel(preferredModel);
    create.reset();
    setNewOpen(true);
  };

  const chooseProvider = (next: ProviderId) => {
    setProvider(next);
    setModel(modelsByProvider(next)[0]?.id ?? '');
  };

  const submit = async () => {
    if (!model) {
      toast('Choose a model', 'Select a model before starting the conversation.', 'error');
      return;
    }
    try {
      const result = await create.mutateAsync({
        title: title.trim() || undefined,
        projectId: newProjectId,
        provider,
        model,
      });
      setNewOpen(false);
      router.push(`/conversation/${result.conversation.id}`);
    } catch {
      // The mutation error is rendered inside the sheet.
    }
  };

  const hasFilters = deferredSearch.length > 0 || projectId !== null;
  const selectedProject = projects.find((project) => project.id === projectId);
  const createError = create.error instanceof Error ? create.error.message : null;

  return (
    <View style={styles.flex}>
      <PageHeader
        title="Chat"
        subtitle={
          conversationsQuery.isLoading
            ? 'Loading conversations…'
            : `${plural(conversations.length, 'conversation')} · direct model access`
        }
        right={
          <IconButton
            icon="add"
            variant="surface"
            onPress={openNew}
            accessibilityLabel="New conversation"
          />
        }
      />
      <OfflineBanner />
      <ScrollScreen
        refreshing={conversationsQuery.isFetching || projectsQuery.isFetching}
        onRefresh={() => {
          void conversationsQuery.refetch();
          void projectsQuery.refetch();
        }}
        bottomPadding={insets.bottom + 110}
      >
        <View style={styles.stack}>
          <Appear>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder="Search conversations"
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

          {projects.length > 0 ? (
            <Appear delay={30}>
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
              </ScrollView>
            </Appear>
          ) : null}

          {conversationsQuery.isLoading ? (
            <ListSkeleton rows={4} />
          ) : conversationsQuery.isError ? (
            <ErrorState
              message={conversationsQuery.error.message}
              onRetry={() => conversationsQuery.refetch()}
            />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={hasFilters ? 'search-outline' : 'chatbubbles-outline'}
              title={
                hasFilters
                  ? 'No matching conversations'
                  : selectedProject
                    ? `${selectedProject.name} has no chat yet`
                    : 'Start a conversation'
              }
              description={
                hasFilters
                  ? 'Try a different search term or project filter.'
                  : 'Talk directly to your chosen model. History is saved and streams back as it is written.'
              }
              actionLabel={hasFilters ? 'Clear filters' : 'New conversation'}
              onAction={
                hasFilters
                  ? () => {
                      setSearch('');
                      setProjectId(null);
                    }
                  : openNew
              }
            />
          ) : (
            <View>
              <SectionHeader
                title={selectedProject?.name ?? 'Recent conversations'}
                subtitle="Newest activity first · tap to continue"
                action={
                  hasFilters ? (
                    <Pressable
                      onPress={() => {
                        setSearch('');
                        setProjectId(null);
                      }}
                      hitSlop={8}
                    >
                      <Text variant="caption" tone="secondary">
                        Clear
                      </Text>
                    </Pressable>
                  ) : undefined
                }
              />
              <View style={styles.list}>
                {conversations.map((conversation, index) => (
                  <Appear key={conversation.id} delay={Math.min(index, 6) * 20}>
                    <ConversationCard
                      conversation={conversation}
                      accent={accent.accent}
                      onPress={() => router.push(`/conversation/${conversation.id}`)}
                    />
                  </Appear>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollScreen>

      <Sheet
        visible={newOpen}
        onClose={() => setNewOpen(false)}
        title="New conversation"
        subtitle="Choose the provider and model this thread will use."
        footer={
          <>
            <Button
              label="Start conversation"
              icon="arrow-forward"
              iconPosition="right"
              fullWidth
              loading={create.isPending}
              disabled={!model}
              onPress={() => void submit()}
            />
            {createError ? (
              <Text variant="caption" tone="danger">
                {createError}
              </Text>
            ) : null}
          </>
        }
      >
        <Input
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Optional — generated from your first message"
          maxLength={120}
        />

        {projects.length > 0 ? (
          <View style={styles.sheetBlock}>
            <Text variant="label">Project</Text>
            <View style={styles.chipWrap}>
              <Chip
                label="No project"
                selected={newProjectId === null}
                onPress={() => setNewProjectId(null)}
              />
              {projects.map((project) => (
                <Chip
                  key={project.id}
                  label={project.name}
                  selected={newProjectId === project.id}
                  onPress={() => setNewProjectId(project.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.sheetBlock}>
          <Text variant="label">Provider</Text>
          <View style={styles.chipWrap}>
            {PROVIDERS.map((item) => (
              <Chip
                key={item}
                label={PROVIDER_META[item].label}
                selected={provider === item}
                onPress={() => chooseProvider(item)}
              />
            ))}
          </View>
        </View>

        <View style={styles.sheetBlock}>
          <View style={styles.sheetHeader}>
            <Text variant="label">Model</Text>
            {selectedModel ? (
              <Text variant="caption" tone="faint">
                {Math.round(selectedModel.contextWindow / 1_000)}k context
              </Text>
            ) : null}
          </View>
          <Card padded={false}>
            {providerModels.map((item, index) => {
              const selected = item.id === model;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setModel(item.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.modelRow,
                    index < providerModels.length - 1 && styles.modelDivider,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.modelText}>
                    <Text variant="bodyMedium" tone={selected ? 'primary' : 'secondary'}>
                      {item.label}
                    </Text>
                    <Text variant="caption" tone="faint">
                      {item.description}
                    </Text>
                  </View>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={18} color={accent.accent} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={18} color={colors.textFaint} />
                  )}
                </Pressable>
              );
            })}
          </Card>
          <Text variant="caption" tone="faint">
            Usage is reported by the provider when available. Anything estimated is marked as
            such and is never presented as billing data.
          </Text>
        </View>
      </Sheet>
    </View>
  );
}

function ConversationCard({
  conversation,
  accent,
  onPress,
}: {
  conversation: Conversation;
  accent: string;
  onPress: () => void;
}) {
  const meta = PROVIDER_META[conversation.provider];
  const model = getModel(conversation.model);
  const snippet = conversation.lastMessage?.replace(/\s+/g, ' ').trim();

  return (
    <Card onPress={onPress} style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <View style={[styles.providerDot, { backgroundColor: meta.accent }]} />
          <Text variant="bodySemibold" numberOfLines={1} style={styles.cardTitle}>
            {conversation.title}
          </Text>
        </View>
        <Text variant="caption" tone="faint">
          {relativeTime(conversation.updatedAt)}
        </Text>
      </View>
      <Text
        variant="caption"
        tone={snippet ? 'tertiary' : 'faint'}
        numberOfLines={2}
        style={styles.snippet}
      >
        {snippet || 'No messages yet. Open the thread to start.'}
      </Text>
      <View style={styles.cardFooter}>
        <Badge label={meta.label} tone="neutral" />
        <Text variant="monoSmall" tone="faint" numberOfLines={1} style={styles.modelLabel}>
          {model?.label ?? conversation.model}
        </Text>
        {conversation.projectName ? (
          <View style={styles.projectTag}>
            <Ionicons name="folder-outline" size={11} color={colors.textFaint} />
            <Text variant="caption" tone="faint" numberOfLines={1}>
              {conversation.projectName}
            </Text>
          </View>
        ) : null}
        <Text variant="caption" tone="faint" style={styles.count}>
          {plural(conversation.messageCount ?? 0, 'message')}
        </Text>
      </View>
      <View style={[styles.accentLine, { backgroundColor: accent }]} />
    </Card>
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
  chipRow: {
    gap: space.sm,
    paddingRight: space.xl,
  },
  list: {
    gap: space.md,
  },
  card: {
    gap: space.sm,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
    minWidth: 0,
  },
  providerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cardTitle: {
    flex: 1,
  },
  snippet: {
    lineHeight: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexWrap: 'wrap',
  },
  modelLabel: {
    flexShrink: 1,
  },
  projectTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 1,
  },
  count: {
    marginLeft: 'auto',
  },
  accentLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    opacity: 0.55,
  },
  sheetBlock: {
    gap: space.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 56,
  },
  modelDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modelText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.72,
  },
});
