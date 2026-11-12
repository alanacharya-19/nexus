import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  PROVIDER_META,
  PROVIDERS,
  getModel,
  modelsByProvider,
  type ConversationMessage,
  type MessageStatus,
  type ProviderId,
} from '@nexus/shared';
import { useConversation, useConversationMutations } from '@/hooks/queries';
import { useChatStream } from '@/hooks/use-chat-stream';
import { getDeviceProviderKey } from '@/lib/provider-keys';
import {
  formatCost,
  formatDuration,
  formatTokens,
  relativeTime,
} from '@/lib/format';
import { colors, radius, space, useAccent } from '@/theme';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';
import { Markdown } from '@/components/ui/markdown';
import { MessageBlock } from '@/components/chat/message-block';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { LoadingState } from '@/components/ui/loading';
import { Appear } from '@/components/ui/animated';
import { toast } from '@/stores/toast';

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const conversationId = Array.isArray(params.id) ? params.id[0] ?? '' : params.id ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useAccent();

  const conversationQuery = useConversation(conversationId);
  const { update, remove } = useConversationMutations();

  const data = conversationQuery.data;
  const initialMessages = useMemo(() => data?.messages ?? [], [data]);
  const chat = useChatStream(conversationId, initialMessages);

  const [draft, setDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editProvider, setEditProvider] = useState<ProviderId>('openai');
  const [editModel, setEditModel] = useState('');
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const autoScrollRef = useRef(true);

  const conversation = data?.conversation;
  const messages = chat.messages;
  const projectedModels = useMemo(() => modelsByProvider(editProvider), [editProvider]);

  const scrollToEnd = () => {
    if (!autoScrollRef.current) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || !conversation || chat.streaming) return;
    setDraft('');
    autoScrollRef.current = true;
    try {
      const deviceKey = await getDeviceProviderKey(conversation.provider);
      await chat.send({
        content,
        provider: conversation.provider,
        model: conversation.model,
        deviceKey,
      });
    } catch (caught) {
      setDraft(content);
      toast(
        'Message not sent',
        caught instanceof Error ? caught.message : 'Could not send the message.',
        'error'
      );
    }
  };

  const openSettings = () => {
    if (!conversation) return;
    setEditTitle(conversation.title);
    setEditProvider(conversation.provider);
    setEditModel(conversation.model);
    setEditProjectId(conversation.projectId);
    update.reset();
    remove.reset();
    setSettingsOpen(true);
  };

  const chooseEditProvider = (next: ProviderId) => {
    setEditProvider(next);
    setEditModel(modelsByProvider(next)[0]?.id ?? '');
  };

  const saveSettings = async () => {
    if (!conversation) return;
    if (!editModel) {
      toast('Choose a model', 'Pick a model before saving.', 'error');
      return;
    }
    try {
      await update.mutateAsync({
        id: conversation.id,
        input: {
          title: editTitle.trim() || conversation.title,
          projectId: editProjectId,
          provider: editProvider,
          model: editModel,
        },
      });
      setSettingsOpen(false);
      toast('Conversation updated', 'New messages use these settings.', 'success');
    } catch {
      // The mutation error is rendered inside the sheet.
    }
  };

  const deleteConversation = async () => {
    if (!conversation) return;
    try {
      await remove.mutateAsync(conversation.id);
      setSettingsOpen(false);
      toast('Conversation deleted', 'The thread and its messages were removed.', 'success');
      router.replace('/chat');
    } catch {
      // The mutation hook reports the failure.
    }
  };

  if (conversationQuery.isLoading) {
    return (
      <View style={styles.flex}>
        <PageHeader back title="Conversation" subtitle="Loading messages…" />
        <LoadingState label="Opening the thread" />
      </View>
    );
  }

  if (conversationQuery.isError || !conversation) {
    return (
      <View style={styles.flex}>
        <PageHeader back title="Conversation" />
        <ErrorState
          message={
            conversationQuery.error instanceof Error
              ? conversationQuery.error.message
              : 'This conversation could not be opened.'
          }
          onRetry={() => conversationQuery.refetch()}
        />
      </View>
    );
  }

  const model = getModel(conversation.model);
  const providerMeta = PROVIDER_META[conversation.provider];
  const busy = chat.streaming;
  const editingError =
    update.error instanceof Error
      ? update.error.message
      : remove.error instanceof Error
        ? remove.error.message
        : null;

  return (
    <View style={styles.flex}>
      <PageHeader
        back
        eyebrow={
          conversation.projectName ? (
            <Badge label={conversation.projectName} tone="lavender" />
          ) : undefined
        }
        title={conversation.title}
        subtitle={`${providerMeta.label} · ${model?.label ?? conversation.model}`}
        right={
          <>
            {busy ? (
              <Badge
                label={chat.status === 'reconnecting' ? 'Reconnecting' : 'Streaming'}
                tone={chat.status === 'reconnecting' ? 'amber' : 'mint'}
                dot
              />
            ) : null}
            <IconButton
              icon="ellipsis-horizontal"
              variant="surface"
              onPress={openSettings}
              accessibilityLabel="Conversation settings"
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
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={(event) => {
            const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
            autoScrollRef.current =
              contentOffset.y + layoutMeasurement.height >= contentSize.height - 96;
          }}
          scrollEventThrottle={120}
          onContentSizeChange={scrollToEnd}
        >
          {messages.length === 0 ? (
            <EmptyState
              icon="chatbubbles-outline"
              title="Say something"
              description={`This thread is connected to ${providerMeta.label} ${
                model?.label ?? conversation.model
              }. Your first message sets the title.`}
            />
          ) : (
            <View style={styles.thread}>
              {messages.map((message, index) => (
                <Appear key={message.id} delay={index < 4 ? index * 30 : 0}>
                  <ConversationMessageView message={message} />
                </Appear>
              ))}
            </View>
          )}
        </ScrollView>

        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          {chat.error ? (
            <Pressable
              onPress={chat.clearError}
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              style={styles.errorBanner}
            >
              <Ionicons name="alert-circle" size={14} color={colors.danger} />
              <Text variant="caption" tone="danger" style={styles.errorText}>
                {chat.error}
              </Text>
              <Ionicons name="close" size={13} color={colors.textFaint} />
            </Pressable>
          ) : null}

          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={() => void send()}
            onCancel={() => void chat.cancel()}
            streaming={busy}
            hint={
              busy
                ? 'Stop keeps the text received so far'
                : chat.status === 'reconnecting'
                  ? 'Reconnecting to the response stream…'
                  : `Replying with ${model?.label ?? conversation.model}`
            }
          />
        </View>
      </KeyboardAvoidingView>

      <Sheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Thread settings"
        subtitle="Change the title, project, or the model used for new messages."
        footer={
          <>
            <Button
              label="Save changes"
              fullWidth
              loading={update.isPending}
              onPress={() => void saveSettings()}
            />
            <Button
              label="Delete conversation"
              variant="danger"
              fullWidth
              loading={remove.isPending}
              onPress={() => void deleteConversation()}
            />
            {editingError ? (
              <Text variant="caption" tone="danger">
                {editingError}
              </Text>
            ) : null}
          </>
        }
      >
        <Input
          label="Title"
          value={editTitle}
          onChangeText={setEditTitle}
          maxLength={120}
        />

        <View style={styles.sheetBlock}>
          <Text variant="label">Provider</Text>
          <View style={styles.chipWrap}>
            {PROVIDERS.map((item) => (
              <Chip
                key={item}
                label={PROVIDER_META[item].label}
                selected={editProvider === item}
                onPress={() => chooseEditProvider(item)}
              />
            ))}
          </View>
        </View>

        <View style={styles.sheetBlock}>
          <Text variant="label">Model</Text>
          <Card padded={false}>
            {projectedModels.map((item, index) => {
              const selected = item.id === editModel;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setEditModel(item.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.modelRow,
                    index < projectedModels.length - 1 && styles.modelDivider,
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
                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={selected ? accent.accent : colors.textFaint}
                  />
                </Pressable>
              );
            })}
          </Card>
          <Text variant="caption" tone="faint">
            Existing messages keep their original model. Only new responses use this selection.
          </Text>
        </View>
      </Sheet>
    </View>
  );
}

function ConversationMessageView({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';
  const meta = message.metadata;
  const status = meta.status;
  const streaming = status === 'pending' || status === 'streaming';
  const model = meta.model ? getModel(meta.model) : undefined;
  const provider = meta.provider ? PROVIDER_META[meta.provider] : undefined;
  const usage = meta.usage;
  const totalTokens = usage ? usage.inputTokens + usage.outputTokens : 0;

  if (isUser) {
    return (
      <MessageBlock
        author={{ name: 'You', role: 'Message' }}
        tone="user"
        time={relativeTime(message.createdAt)}
      >
        <Text variant="body" tone="primary">
          {message.content}
        </Text>
      </MessageBlock>
    );
  }

  return (
    <MessageBlock
      author={{
        name: 'NEXUS',
        role: provider?.label ?? 'Assistant',
        model: model?.label ?? meta.model,
        accent: provider?.accent,
      }}
      streaming={streaming}
      badge={statusBadge(status)}
      time={relativeTime(message.createdAt)}
      footer={
        <>
          {usage ? (
            <>
              <Badge
                label={`${formatTokens(usage.inputTokens)} in · ${formatTokens(
                  usage.outputTokens
                )} out`}
                tone="neutral"
              />
              <Badge
                label={usage.source === 'provider' ? 'Provider usage' : 'Estimated usage'}
                tone={usage.source === 'provider' ? 'mint' : 'amber'}
              />
            </>
          ) : null}
          {typeof meta.costUsd === 'number' ? (
            <Text variant="caption" tone="faint">
              {formatCost(meta.costUsd)}
              {meta.costEstimated === false ? ' billed' : ' est.'}
            </Text>
          ) : null}
          {typeof meta.latencyMs === 'number' && meta.latencyMs > 0 ? (
            <Text variant="caption" tone="faint">
              {formatDuration(meta.latencyMs)}
            </Text>
          ) : null}
          {usage ? (
            <Text variant="caption" tone="faint">
              {formatTokens(totalTokens)} tokens
            </Text>
          ) : null}
        </>
      }
    >
      {message.content.length > 0 ? (
        <Markdown content={message.content} compact />
      ) : streaming ? (
        <Text variant="body" tone="faint">
          Thinking…
        </Text>
      ) : status === 'cancelled' ? (
        <Text variant="body" tone="tertiary">
          Response stopped.
        </Text>
      ) : (
        <Text variant="body" tone="tertiary">
          No content was returned.
        </Text>
      )}

      {meta.error ? (
        <View style={styles.messageError}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.danger} />
          <View style={styles.messageErrorText}>
            <Text variant="caption" tone="danger">
              {meta.error.message}
            </Text>
            <Text variant="caption" tone="faint">
              {meta.error.retryable
                ? 'Send the message again to retry, or switch models in thread settings.'
                : 'Check the provider key and model in thread settings.'}
            </Text>
          </View>
        </View>
      ) : null}
    </MessageBlock>
  );
}

function statusBadge(status: MessageStatus): string | undefined {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'streaming':
      return 'Writing';
    case 'cancelled':
      return 'Stopped';
    case 'error':
      return 'Failed';
    default:
      return undefined;
  }
}

function ChatComposer({
  value,
  onChangeText,
  onSend,
  onCancel,
  streaming,
  hint,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  streaming: boolean;
  hint: string;
}) {
  const accent = useAccent();
  const canSend = !streaming && value.trim().length > 0;

  return (
    <View style={styles.composer}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Message NEXUS…"
        placeholderTextColor={colors.textFaint}
        multiline
        style={styles.composerInput}
        selectionColor={accent.accent}
        accessibilityLabel="Message"
      />
      <View style={styles.composerFooter}>
        <Text variant="caption" tone="faint" numberOfLines={1} style={styles.composerHint}>
          {hint}
        </Text>
        {streaming ? (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Stop response"
            style={({ pressed }) => [
              styles.stop,
              { borderColor: `${accent.accent}66` },
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.stopSquare, { backgroundColor: accent.accent }]} />
          </Pressable>
        ) : (
          <Pressable
            onPress={onSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
            style={({ pressed }) => [
              styles.send,
              { backgroundColor: canSend ? accent.accent : colors.surfaceHigh },
              pressed && canSend && styles.pressed,
            ]}
          >
            <Ionicons
              name="arrow-up"
              size={18}
              color={canSend ? accent.onAccent : colors.textFaint}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
  },
  thread: {
    gap: space.xl,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  bottom: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingTop: space.sm,
    gap: space.sm,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(242,122,122,0.24)',
    backgroundColor: colors.dangerSurface,
  },
  errorText: {
    flex: 1,
  },
  composer: {
    marginHorizontal: space.lg,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    gap: space.sm,
  },
  composerInput: {
    minHeight: 42,
    maxHeight: 140,
    color: colors.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
    textAlignVertical: 'top',
  },
  composerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  composerHint: {
    flex: 1,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceRaised,
  },
  stopSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  messageError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(242,122,122,0.24)',
  },
  messageErrorText: {
    flex: 1,
    gap: 2,
  },
  sheetBlock: {
    gap: space.sm,
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
