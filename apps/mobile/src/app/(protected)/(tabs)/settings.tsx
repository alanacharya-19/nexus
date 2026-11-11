import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PROVIDER_META, PROVIDERS, ROLE_META, getModel } from '@nexus/shared';
import type { ProviderId } from '@nexus/shared';
import { api, getApiBaseUrl } from '@/lib/api';
import { APP_VERSION } from '@/lib/config';
import { formatCost, formatTokens, plural } from '@/lib/format';
import { useAuthStore, useSettingsStore } from '@/stores/auth';
import { usePreferencesStore } from '@/stores/preferences';
import type { NotificationPreferences } from '@/stores/preferences';
import {
  useAgents,
  useCredentials,
  useCredentialMutations,
  useUsageSummary,
} from '@/hooks/queries';
import {
  accentThemes,
  colors,
  radius,
  space,
  useAccent,
  type AccentThemeId,
} from '@/theme';
import { ScrollScreen } from '@/components/ui/screen';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Dialog } from '@/components/ui/dialog';
import { SectionHeader } from '@/components/ui/section-header';
import { ListRow } from '@/components/ui/list-row';
import { SwitchRow } from '@/components/ui/switch-row';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { ListSkeleton } from '@/components/ui/loading';
import { Appear } from '@/components/ui/animated';
import { toast } from '@/stores/toast';

const ACCENT_ORDER = Object.keys(accentThemes) as AccentThemeId[];

const NOTIFICATION_COPY: Record<
  keyof NotificationPreferences,
  { label: string; description: string }
> = {
  runCompleted: {
    label: 'Run completed',
    description: 'Get a summary when the final artifact is ready.',
  },
  approvalNeeded: {
    label: 'Approval needed',
    description: 'Alert when an agent is blocked waiting for your review.',
  },
  runFailed: {
    label: 'Run failed',
    description: 'Know immediately when the pipeline stops with an error.',
  },
  dailyDigest: {
    label: 'Daily digest',
    description: 'A single evening roundup of every workspace.',
  },
};

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);
  const signOut = useAuthStore((state) => state.signOut);
  const apiUrl = useSettingsStore((state) => state.apiUrl);
  const setApiUrl = useSettingsStore((state) => state.setApiUrl);
  const accent = useAccent();

  const accentId = usePreferencesStore((state) => state.accent);
  const setAccent = usePreferencesStore((state) => state.setAccent);
  const haptics = usePreferencesStore((state) => state.haptics);
  const setHaptics = usePreferencesStore((state) => state.setHaptics);
  const reduceMotion = usePreferencesStore((state) => state.reduceMotion);
  const setReduceMotion = usePreferencesStore((state) => state.setReduceMotion);
  const compactLists = usePreferencesStore((state) => state.compactLists);
  const setCompactLists = usePreferencesStore((state) => state.setCompactLists);
  const notifications = usePreferencesStore((state) => state.notifications);
  const setNotification = usePreferencesStore((state) => state.setNotification);

  const credentialsQuery = useCredentials();
  const agentsQuery = useAgents();
  const usageQuery = useUsageSummary(30);
  const capabilities = useQuery({
    queryKey: ['capabilities', apiUrl],
    queryFn: api.capabilities,
    retry: 1,
    staleTime: 60_000,
  });

  const [serverOpen, setServerOpen] = useState(false);
  const [serverDraft, setServerDraft] = useState(apiUrl);
  const [serverSaving, setServerSaving] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [cacheOpen, setCacheOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId | null>(null);

  const credentials = credentialsQuery.data ?? [];
  const user = session?.user;
  const displayName = user?.name ?? user?.email?.split('@')[0] ?? 'NEXUS operator';
  const summary = usageQuery.data;
  const agents = agentsQuery.data ?? [];

  const saveServer = async () => {
    const candidate = serverDraft.trim();
    if (!/^https?:\/\/.+/i.test(candidate)) {
      toast('Invalid server URL', 'The address must start with http:// or https://', 'error');
      return;
    }
    setServerSaving(true);
    await setApiUrl(candidate);
    await queryClient.invalidateQueries({ queryKey: ['capabilities'] });
    setServerSaving(false);
    setServerOpen(false);
    toast('Server updated', candidate, 'success');
  };

  const clearLocalCache = () => {
    setCacheOpen(false);
    queryClient.clear();
    toast('Local cache cleared', 'The next screen load will fetch fresh data.', 'success');
  };

  const serverStatus = capabilities.isError
    ? 'Unreachable'
    : capabilities.isLoading
      ? 'Checking…'
      : `Online · v${capabilities.data?.version ?? '?'}`;

  return (
    <View style={styles.flex}>
      <PageHeader title="Settings" subtitle="Account, intelligence, appearance, and access" />
      <OfflineBanner />
      <ScrollScreen
        refreshing={credentialsQuery.isFetching || capabilities.isFetching}
        onRefresh={() => {
          void credentialsQuery.refetch();
          void capabilities.refetch();
          void agentsQuery.refetch();
          void usageQuery.refetch();
        }}
        bottomPadding={insets.bottom + 110}
      >
        <View style={styles.stack}>
          <Appear>
            <View>
              <SectionHeader title="Account" subtitle="The operator behind this workspace" />
              <Card tone="raised" style={styles.profile}>
                <Avatar name={displayName} accent={accent.accent} size={48} />
                <View style={styles.profileText}>
                  <Text variant="bodySemibold" numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text variant="caption" tone="tertiary" numberOfLines={1}>
                    {user?.email ?? 'Not signed in'}
                  </Text>
                  <Badge
                    label={
                      session?.mode === 'supabase' ? 'Supabase account' : 'Local workspace'
                    }
                    tone="neutral"
                  />
                </View>
              </Card>
            </View>
          </Appear>

          <Appear delay={30}>
            <View>
              <SectionHeader
                title="AI providers"
                subtitle="Bring your own model access, or use the server keys"
              />
              <Card padded={false}>
                {PROVIDERS.map((item, index) => {
                  const credential = credentials.find((entry) => entry.provider === item);
                  const meta = PROVIDER_META[item];
                  const configured = credential?.configured ?? false;
                  return (
                    <ListRow
                      key={item}
                      icon="key-outline"
                      iconColor={meta.accent}
                      title={meta.label}
                      subtitle={
                        configured
                          ? credential?.source === 'user'
                            ? `Your key ${credential?.hint ?? ''}`.trim()
                            : 'Using the server key'
                          : 'No key configured'
                      }
                      value={
                        configured
                          ? credential?.source === 'user'
                            ? 'Yours'
                            : 'Server'
                          : undefined
                      }
                      trailing={
                        configured ? (
                          <Badge
                            label={credential?.source === 'user' ? 'Active' : 'Server'}
                            tone={credential?.source === 'user' ? 'mint' : 'ice'}
                          />
                        ) : (
                          <Badge label="Add" tone="neutral" />
                        )
                      }
                      onPress={() => setProvider(item)}
                      showDivider={index < PROVIDERS.length - 1}
                    />
                  );
                })}
              </Card>
              <Text variant="caption" tone="faint" style={styles.note}>
                Keys are encrypted on the server. This device only receives a masked hint.
              </Text>
            </View>
          </Appear>

          <Appear delay={60}>
            <View>
              <SectionHeader
                title="Models"
                subtitle="Default model captured for each pipeline role"
                action={
                  <Pressable onPress={() => router.push('/agents')} hitSlop={8}>
                    <Text variant="caption" tone="secondary">
                      Edit
                    </Text>
                  </Pressable>
                }
              />
              {agentsQuery.isLoading ? (
                <ListSkeleton rows={1} />
              ) : agents.length === 0 ? (
                <Card tone="flat">
                  <Text variant="caption" tone="tertiary">
                    No agents configured yet. The core lineup is created on first sign-in.
                  </Text>
                </Card>
              ) : (
                <Card padded={false}>
                  {agents.map((agent, index) => {
                    const model = getModel(agent.model);
                    return (
                      <ListRow
                        key={agent.id}
                        icon="cube-outline"
                        iconColor={agent.accent}
                        title={agent.name}
                        subtitle={`${ROLE_META[agent.role].label} · ${PROVIDER_META[agent.provider].label}`}
                        value={model?.label ?? agent.model}
                        onPress={() => router.push(`/agents/${agent.id}`)}
                        showDivider={index < agents.length - 1}
                      />
                    );
                  })}
                </Card>
              )}
            </View>
          </Appear>

          <Appear delay={90}>
            <View>
              <SectionHeader
                title="Appearance"
                subtitle="Tune the interface without leaving the dark theme"
              />
              <Card style={styles.appearanceCard}>
                <View style={styles.appearanceHeader}>
                  <View style={styles.flexText}>
                    <Text variant="bodyMedium">Accent</Text>
                    <Text variant="caption" tone="tertiary">
                      Applied to actions, active tabs, and live signals.
                    </Text>
                  </View>
                  <Badge label={accentThemes[accentId].label} tone="neutral" />
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.swatchRow}
                >
                  {ACCENT_ORDER.map((id) => {
                    const theme = accentThemes[id];
                    const selected = id === accentId;
                    return (
                      <Pressable
                        key={id}
                        onPress={() => setAccent(id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={theme.label}
                        style={({ pressed }) => [
                          styles.swatch,
                          selected && { borderColor: theme.border },
                          pressed && styles.pressed,
                        ]}
                      >
                        <View
                          style={[
                            styles.swatchDot,
                            { backgroundColor: theme.accent },
                            selected && { shadowColor: theme.accent },
                          ]}
                        >
                          {selected ? (
                            <Ionicons name="checkmark" size={12} color={theme.onAccent} />
                          ) : null}
                        </View>
                        <Text
                          variant="caption"
                          tone={selected ? 'primary' : 'tertiary'}
                          numberOfLines={1}
                        >
                          {theme.label.split(' ')[0]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </Card>
              <Card padded={false} style={styles.switchCard}>
                <View style={styles.switchGroup}>
                  <View style={styles.switchDivider}>
                    <SwitchRow
                      label="Haptics"
                      description="Tactile feedback for primary actions."
                      value={haptics}
                      onValueChange={setHaptics}
                    />
                  </View>
                  <View style={styles.switchDivider}>
                    <SwitchRow
                      label="Reduce motion"
                      description="Replace springs and pulses with quiet fades."
                      value={reduceMotion}
                      onValueChange={setReduceMotion}
                    />
                  </View>
                  <SwitchRow
                    label="Compact lists"
                    description="Tighter spacing for long project histories."
                    value={compactLists}
                    onValueChange={setCompactLists}
                  />
                </View>
              </Card>
            </View>
          </Appear>

          <Appear delay={120}>
            <View>
              <SectionHeader
                title="Notifications"
                subtitle="Stored on this device; delivery preferences only"
              />
              <Card padded={false}>
                <View style={styles.switchGroup}>
                  {(Object.keys(NOTIFICATION_COPY) as (keyof NotificationPreferences)[]).map(
                    (key, index, list) => (
                      <View
                        key={key}
                        style={index < list.length - 1 ? styles.switchDivider : undefined}
                      >
                        <SwitchRow
                          label={NOTIFICATION_COPY[key].label}
                          description={NOTIFICATION_COPY[key].description}
                          value={notifications[key]}
                          onValueChange={(value) => setNotification(key, value)}
                        />
                      </View>
                    )
                  )}
                </View>
              </Card>
            </View>
          </Appear>

          <Appear delay={150}>
            <View>
              <SectionHeader
                title="Connection"
                subtitle="Where this app sends its requests"
              />
              <Card padded={false}>
                <ListRow
                  icon="server-outline"
                  title="API server"
                  subtitle={apiUrl}
                  value={serverStatus}
                  onPress={() => {
                    setServerDraft(apiUrl);
                    setServerOpen(true);
                  }}
                  showDivider
                />
                <ListRow
                  icon="pulse-outline"
                  title="Server capabilities"
                  subtitle={
                    capabilities.data
                      ? `${capabilities.data.authModes.join(', ')} auth · ${capabilities.data.limits.maxConcurrentRuns} concurrent runs`
                      : capabilities.isError
                        ? 'Could not reach the server'
                        : 'Fetching server details'
                  }
                  value={
                    capabilities.data
                      ? `${capabilities.data.providers.filter((item) => item.serverKey).length} keys`
                      : undefined
                  }
                  onPress={capabilities.isError ? () => capabilities.refetch() : undefined}
                  showDivider={false}
                />
              </Card>
            </View>
          </Appear>

          <Appear delay={180}>
            <View>
              <SectionHeader
                title="API usage"
                subtitle="Aggregated across every provider"
                action={
                  <Pressable onPress={() => router.push('/usage')} hitSlop={8}>
                    <Text variant="caption" tone="secondary">
                      Details
                    </Text>
                  </Pressable>
                }
              />
              <Card padded={false}>
                <ListRow
                  icon="stats-chart-outline"
                  title="Usage this month"
                  subtitle={
                    summary
                      ? `${plural(summary.calls, 'call')} · ${formatTokens(summary.totalTokens)} tokens`
                      : 'No usage recorded yet'
                  }
                  value={summary ? formatCost(summary.totalCostUsd) : undefined}
                  onPress={() => router.push('/usage')}
                  showDivider
                />
                <ListRow
                  icon="card-outline"
                  title="Spend and budgets"
                  subtitle="Per-provider cost, tokens, and daily trend."
                  onPress={() => router.push('/usage')}
                />
              </Card>
            </View>
          </Appear>

          <Appear delay={210}>
            <View>
              <SectionHeader title="Security" subtitle="Session and on-device data" />
              <Card padded={false}>
                <ListRow
                  icon="shield-checkmark-outline"
                  title="Session mode"
                  subtitle={
                    session?.mode === 'supabase'
                      ? 'Authenticated with Supabase'
                      : 'Local workspace session'
                  }
                  value={session?.mode === 'supabase' ? 'Supabase' : 'Local'}
                  showDivider
                />
                <ListRow
                  icon="trash-outline"
                  title="Clear local cache"
                  subtitle="Remove cached runs, agents, and usage. Drafts stay on device."
                  onPress={() => setCacheOpen(true)}
                  showDivider
                />
                <ListRow
                  icon="log-out-outline"
                  title="Sign out"
                  subtitle="Remove this session from the device"
                  onPress={() => setSignOutOpen(true)}
                  danger
                />
              </Card>
            </View>
          </Appear>

          <Appear delay={240}>
            <View>
              <SectionHeader title="About NEXUS" />
              <Card padded={false}>
                <ListRow
                  icon="information-circle-outline"
                  title="Version"
                  value={APP_VERSION}
                  showDivider
                />
                <ListRow
                  icon="flash-outline"
                  title="Foundation"
                  subtitle="Dark-first agent workspace · local preferences"
                  showDivider
                />
                <ListRow
                  icon="layers-outline"
                  title="Pipeline"
                  subtitle="Planner · Worker · Reviewer · Polisher"
                />
              </Card>
              <Text variant="caption" tone="faint" style={styles.note}>
                NEXUS coordinates a specialist lineup so plans, execution, review, and polish
                stay in one auditable conversation.
              </Text>
            </View>
          </Appear>
        </View>
      </ScrollScreen>

      <Sheet
        visible={serverOpen}
        onClose={() => setServerOpen(false)}
        title="API server"
        subtitle="Point the app at your NEXUS API. Include the /v1 path."
        footer={
          <>
            <Button
              label="Save and reconnect"
              fullWidth
              loading={serverSaving}
              onPress={() => void saveServer()}
            />
            <Button
              label="Reset to default"
              variant="ghost"
              fullWidth
              onPress={() => setServerDraft('http://localhost:4000/v1')}
            />
          </>
        }
      >
        <Input
          label="API URL"
          value={serverDraft}
          onChangeText={setServerDraft}
          placeholder="http://192.168.1.20:4000/v1"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          mono
        />
        <Text variant="caption" tone="tertiary">
          Current address: {getApiBaseUrl()}
        </Text>
      </Sheet>

      <CredentialSheet provider={provider} onClose={() => setProvider(null)} />

      <Dialog
        visible={cacheOpen}
        onClose={() => setCacheOpen(false)}
        title="Clear local cache?"
        description="Cached workspace data will be fetched again on the next screen. Drafts and preferences are kept."
        icon="trash-outline"
        tone="danger"
        footer={
          <>
            <Button
              label="Clear cache"
              variant="danger"
              fullWidth
              onPress={clearLocalCache}
            />
            <Button
              label="Keep cache"
              variant="ghost"
              fullWidth
              onPress={() => setCacheOpen(false)}
            />
          </>
        }
      />

      <Dialog
        visible={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title="Sign out?"
        description="Local drafts remain on this device, but cached workspace data is cleared."
        icon="log-out-outline"
        tone="danger"
        footer={
          <>
            <Button
              label="Sign out"
              variant="danger"
              fullWidth
              onPress={() => {
                setSignOutOpen(false);
                void signOut();
              }}
            />
            <Button
              label="Stay signed in"
              variant="ghost"
              fullWidth
              onPress={() => setSignOutOpen(false)}
            />
          </>
        }
      >
        <Text variant="body" tone="secondary">
          You will need your credentials or the local workspace sign-in to return.
        </Text>
      </Dialog>
    </View>
  );
}

function CredentialSheet({
  provider,
  onClose,
}: {
  provider: ProviderId | null;
  onClose: () => void;
}) {
  const { save, test, remove } = useCredentialMutations();
  const credentialsQuery = useCredentials();
  const [apiKey, setApiKey] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!provider) return null;

  const meta = PROVIDER_META[provider];
  const credential = credentialsQuery.data?.find((entry) => entry.provider === provider);

  const reset = () => {
    setApiKey('');
    setResult(null);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const runTest = async () => {
    if (apiKey.trim().length < 10) {
      setError('Paste a complete API key first.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const response = await test.mutateAsync({ provider, apiKey: apiKey.trim() });
      setResult({
        ok: response.ok,
        message: response.message ?? (response.ok ? 'Key is valid.' : 'Key was rejected.'),
      });
    } catch (caught) {
      setResult({
        ok: false,
        message: caught instanceof Error ? caught.message : 'Could not validate the key.',
      });
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    if (apiKey.trim().length < 10) {
      setError('Paste a complete API key first.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await save.mutateAsync({ provider, apiKey: apiKey.trim() });
      toast('Key saved', `${meta.label} is ready for new runs.`, 'success');
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the key.');
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    setBusy(true);
    try {
      await remove.mutateAsync(provider);
      toast('Key removed', `${meta.label} credentials deleted.`, 'success');
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove the key.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible
      onClose={close}
      title={`${meta.label} access`}
      subtitle="Use your own provider key for this workspace."
      footer={
        <>
          <Button
            label={result?.ok ? 'Save key' : 'Validate and save'}
            fullWidth
            loading={busy}
            onPress={() => void saveKey()}
          />
          <Button
            label="Test key"
            variant="secondary"
            fullWidth
            disabled={busy}
            onPress={() => void runTest()}
          />
          {credential?.source === 'user' ? (
            <Button
              label="Remove saved key"
              variant="danger"
              fullWidth
              disabled={busy}
              onPress={() => void removeKey()}
            />
          ) : null}
        </>
      }
    >
      <View style={styles.sheetIntro}>
        <View style={[styles.providerBadge, { borderColor: `${meta.accent}44` }]}>
          <View style={[styles.providerDot, { backgroundColor: meta.accent }]} />
          <Text variant="caption" tone="secondary">
            {meta.description}
          </Text>
        </View>
        {credential?.configured ? (
          <Badge
            label={
              credential.source === 'user'
                ? `Saved ${credential.hint ?? ''}`
                : 'Server key active'
            }
            tone={credential.source === 'user' ? 'mint' : 'ice'}
          />
        ) : null}
      </View>
      <Input
        label="API key"
        value={apiKey}
        onChangeText={setApiKey}
        placeholder={provider === 'openai' ? 'sk-…' : 'Paste key'}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        mono
      />
      {result ? (
        <View
          style={[
            styles.testResult,
            {
              backgroundColor: result.ok ? colors.successSurface : colors.dangerSurface,
              borderColor: result.ok
                ? 'rgba(143,227,176,0.24)'
                : 'rgba(242,122,122,0.24)',
            },
          ]}
        >
          <Text variant="caption" tone={result.ok ? 'mint' : 'danger'}>
            {result.message}
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : null}
      <Text variant="caption" tone="faint">
        The key is sent once to your server, encrypted at rest, and never returned to this
        device.
      </Text>
    </Sheet>
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
  flexText: {
    flex: 1,
    gap: 2,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  profileText: {
    flex: 1,
    gap: space.xs,
    alignItems: 'flex-start',
  },
  note: {
    marginTop: space.sm,
    paddingHorizontal: space.xs,
    lineHeight: 17,
  },
  appearanceCard: {
    gap: space.lg,
  },
  appearanceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  swatchRow: {
    gap: space.md,
    paddingRight: space.xl,
  },
  swatch: {
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    minWidth: 78,
  },
  swatchDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  switchCard: {
    marginTop: space.md,
  },
  switchGroup: {
    paddingHorizontal: space.lg,
    paddingVertical: space.xs,
  },
  switchDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.72,
  },
  sheetIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
  },
  providerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  testResult: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
  },
});
