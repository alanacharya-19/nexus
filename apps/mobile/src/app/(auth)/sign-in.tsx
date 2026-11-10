import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PROVIDER_META, PROVIDERS } from '@nexus/shared';
import { api, getApiBaseUrl } from '@/lib/api';
import { useAuthStore, useSettingsStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { colors, fonts, radius, space } from '@/theme';

type Mode = 'local' | 'supabase';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const session = useAuthStore((state) => state.session);
  const busy = useAuthStore((state) => state.busy);
  const authError = useAuthStore((state) => state.error);
  const signInDev = useAuthStore((state) => state.signInDev);
  const signInSupabase = useAuthStore((state) => state.signInSupabase);
  const setError = useAuthStore((state) => state.setError);

  const apiUrl = useSettingsStore((state) => state.apiUrl);
  const setApiUrl = useSettingsStore((state) => state.setApiUrl);

  const capabilities = useQuery({
    queryKey: ['capabilities', apiUrl],
    queryFn: api.capabilities,
    retry: 1,
    staleTime: 60_000,
  });

  const modes = useMemo<Mode[]>(() => {
    const available = capabilities.data?.authModes ?? [];
    const result: Mode[] = [];
    if (available.includes('local')) result.push('local');
    if (available.includes('supabase')) result.push('supabase');
    return result;
  }, [capabilities.data]);

  const [mode, setMode] = useState<Mode | null>(null);
  const activeMode: Mode = mode ?? modes[0] ?? 'local';

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverDraft, setServerDraft] = useState(apiUrl);
  const [serverSaving, setServerSaving] = useState(false);

  if (session) return null;

  const submit = async () => {
    setFieldError(null);
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFieldError('Enter a valid email address.');
      return;
    }
    if (activeMode === 'supabase' && password.length < 6) {
      setFieldError('Enter your Supabase password.');
      return;
    }
    try {
      if (activeMode === 'supabase') {
        await signInSupabase({ email: cleanEmail, password });
      } else {
        await signInDev({ email: cleanEmail, name: name.trim() || undefined });
      }
    } catch {
      // The store exposes the message inline.
    }
  };

  const saveServer = async () => {
    const candidate = serverDraft.trim();
    if (!/^https?:\/\/.+/i.test(candidate)) {
      setFieldError('The server URL must start with http:// or https://');
      return;
    }
    setServerSaving(true);
    await setApiUrl(candidate);
    await queryClient.invalidateQueries({ queryKey: ['capabilities'] });
    setServerSaving(false);
    setServerOpen(false);
    setFieldError(null);
  };

  const providers = capabilities.data?.providers ?? [];
  const configuredCount = providers.filter((provider) => provider.serverKey).length;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient
        colors={['rgba(168,199,250,0.10)', 'rgba(8,9,11,0)']}
        style={styles.glow}
        pointerEvents="none"
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.huge, paddingBottom: insets.bottom + space.huge },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandBlock}>
          <View style={styles.mark}>
            <View style={styles.markLine} />
            <View style={styles.markLine} />
            <View style={styles.markLineShort} />
          </View>
          <Text style={styles.wordmark}>NEXUS</Text>
          <Text variant="body" tone="secondary" style={styles.tagline}>
            A private workspace where specialist agents plan, execute, and review real work.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text variant="heading">Enter the workspace</Text>
            <Pressable
              onPress={() => {
                setServerDraft(apiUrl);
                setServerOpen(true);
              }}
              style={styles.serverChip}
              accessibilityRole="button"
              accessibilityLabel="Change server address"
            >
              <View
                style={[
                  styles.serverDot,
                  {
                    backgroundColor: capabilities.isError
                      ? colors.danger
                      : capabilities.isLoading
                        ? colors.amber
                        : colors.mint,
                  },
                ]}
              />
              <Text variant="caption" tone="tertiary">
                Server
              </Text>
              <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
            </Pressable>
          </View>

          {capabilities.isError ? (
            <View style={styles.offlineCard}>
              <Ionicons name="cloud-offline-outline" size={18} color={colors.amber} />
              <View style={styles.offlineText}>
                <Text variant="bodySemibold">Server unreachable</Text>
                <Text variant="caption" tone="tertiary">
                  {capabilities.error instanceof Error
                    ? capabilities.error.message
                    : 'Check that the API is running and the address is correct.'}
                </Text>
                <Text variant="monoSmall" tone="faint">
                  {getApiBaseUrl()}
                </Text>
              </View>
              <Button
                label="Retry"
                size="sm"
                variant="secondary"
                onPress={() => capabilities.refetch()}
              />
            </View>
          ) : null}

          {modes.length > 1 ? (
            <View style={styles.modeRow}>
              {modes.map((item) => {
                const active = activeMode === item;
                return (
                  <Pressable
                    key={item}
                    onPress={() => {
                      setMode(item);
                      setFieldError(null);
                      setError(null);
                    }}
                    style={[styles.mode, active && styles.modeActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text variant="caption" tone={active ? 'primary' : 'tertiary'}>
                      {item === 'local' ? 'Local workspace' : 'Supabase account'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            leftIcon="mail-outline"
            returnKeyType="next"
          />

          {activeMode === 'supabase' ? (
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your Supabase password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              leftIcon="lock-closed-outline"
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          ) : (
            <Input
              label="Display name"
              value={name}
              onChangeText={setName}
              placeholder="Optional"
              autoCapitalize="words"
              leftIcon="person-outline"
              returnKeyType="go"
              onSubmitEditing={submit}
              hint="Local sign-in is enabled by the server for development. No password is stored."
            />
          )}

          {fieldError || authError ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={14} color={colors.danger} />
              <Text variant="caption" tone="danger" style={styles.errorText}>
                {fieldError ?? authError}
              </Text>
            </View>
          ) : null}

          <Button
            label={activeMode === 'supabase' ? 'Sign in' : 'Enter workspace'}
            icon="arrow-forward"
            iconPosition="right"
            size="lg"
            fullWidth
            loading={busy}
            onPress={submit}
            disabled={modes.length === 0}
          />

          {modes.length === 0 && !capabilities.isLoading && !capabilities.isError ? (
            <Text variant="caption" tone="danger">
              This server has no sign-in method enabled. Set ALLOW_DEV_AUTH=true or configure
              Supabase on the API.
            </Text>
          ) : null}

          <View style={styles.providers}>
            <Text variant="label">Model access</Text>
            <View style={styles.providerRow}>
              {PROVIDERS.map((provider) => {
                const configured = providers.find((item) => item.provider === provider)?.serverKey;
                return (
                  <View key={provider} style={styles.provider}>
                    <View
                      style={[
                        styles.providerDot,
                        {
                          backgroundColor: configured
                            ? PROVIDER_META[provider].accent
                            : colors.surfaceHover,
                        },
                      ]}
                    />
                    <Text variant="caption" tone={configured ? 'secondary' : 'faint'}>
                      {PROVIDER_META[provider].label}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text variant="caption" tone="faint">
              {configuredCount > 0
                ? `${configuredCount} provider ${configuredCount === 1 ? 'key is' : 'keys are'} available on this server. Add your own keys in Settings after signing in.`
                : 'No server keys detected. Add your own provider keys in Settings after signing in.'}
            </Text>
          </View>
        </View>

        <Text variant="caption" tone="faint" align="center" style={styles.footer}>
          NEXUS keeps provider keys encrypted server-side and never ships them to this device.
        </Text>
      </ScrollView>

      <Sheet
        visible={serverOpen}
        onClose={() => setServerOpen(false)}
        title="Server address"
        subtitle="Point the app at your NEXUS API. Include the /v1 path."
        footer={
          <>
            <Button label="Save and reconnect" fullWidth loading={serverSaving} onPress={saveServer} />
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
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          mono
        />
        <View style={styles.serverNote}>
          <Badge label="Tip" tone="ice" />
          <Text variant="caption" tone="tertiary" style={styles.serverNoteText}>
            On a physical device, use your computer&apos;s LAN IP instead of localhost. The Expo
            dev server address is detected automatically when available.
          </Text>
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 420,
  },
  content: {
    paddingHorizontal: space.xl,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    gap: space.xxxl,
  },
  brandBlock: {
    gap: space.md,
    paddingTop: space.xl,
  },
  mark: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 11,
  },
  markLine: {
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.text,
    width: '100%',
  },
  markLineShort: {
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.textTertiary,
    width: '55%',
  },
  wordmark: {
    fontFamily: fonts.displayBold,
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: 10,
    color: colors.text,
  },
  tagline: {
    maxWidth: 380,
    fontSize: 15,
    lineHeight: 23,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  serverChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 1,
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  serverDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  offlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.warningSurface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(231,196,138,0.22)',
    padding: space.md,
  },
  offlineText: {
    flex: 1,
    gap: 2,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 2,
  },
  mode: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    borderRadius: radius.sm,
  },
  modeActive: {
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  errorText: {
    flex: 1,
  },
  providers: {
    gap: space.sm,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.lg,
  },
  provider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 1,
  },
  providerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  footer: {
    paddingHorizontal: space.xl,
  },
  serverNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  serverNoteText: {
    flex: 1,
  },
});
