import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  BASE_SYSTEM_PROMPTS,
  PROVIDER_META,
  PROVIDERS,
  ROLE_META,
  modelsByProvider,
} from '@nexus/shared';
import type { Agent, AgentRole, ProviderId } from '@nexus/shared';
import { colors, radius, space } from '@/theme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Badge } from '@/components/ui/badge';
import { Segmented } from '@/components/ui/segmented';
import { SwitchRow } from '@/components/ui/switch-row';
import { SectionHeader } from '@/components/ui/section-header';
import { formatTokens } from '@/lib/format';

const ROLE_OPTIONS = (Object.keys(ROLE_META) as AgentRole[]).map((role) => ({
  label: ROLE_META[role].label,
  value: role,
}));

const TEMPERATURE_OPTIONS = [
  { label: 'Precise', value: '0.2' },
  { label: 'Balanced', value: '0.4' },
  { label: 'Creative', value: '0.7' },
  { label: 'Expressive', value: '1' },
];

const ACCENTS = [
  colors.ice,
  colors.mint,
  colors.amber,
  colors.coral,
  colors.lavender,
  colors.sky,
  colors.danger,
  colors.text,
];

export interface AgentFormValues {
  name: string;
  role: AgentRole;
  provider: ProviderId;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  accent: string;
  enabled: boolean;
}

interface AgentFormProps {
  initial?: Agent;
  roleLocked?: boolean;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (values: AgentFormValues) => void | Promise<void>;
}

export function AgentForm({
  initial,
  roleLocked = false,
  submitLabel,
  busy = false,
  error,
  onSubmit,
}: AgentFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState<AgentRole>(initial?.role ?? 'custom');
  const [provider, setProvider] = useState<ProviderId>(initial?.provider ?? 'openai');
  const [model, setModel] = useState(
    initial?.model ?? modelsByProvider('openai')[0]?.id ?? 'gpt-4.1'
  );
  const [systemPrompt, setSystemPrompt] = useState(
    initial?.systemPrompt ?? BASE_SYSTEM_PROMPTS.custom
  );
  const [temperature, setTemperature] = useState(String(initial?.temperature ?? 0.4));
  const [maxTokens, setMaxTokens] = useState(String(initial?.maxTokens ?? 4096));
  const [accent, setAccent] = useState(initial?.accent ?? ROLE_META.custom.accent);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [localError, setLocalError] = useState<string | null>(null);

  const providerModels = useMemo(() => modelsByProvider(provider), [provider]);
  const selectedModel = providerModels.find((item) => item.id === model);
  const roleMeta = ROLE_META[role];

  const changeRole = (next: AgentRole) => {
    setRole(next);
    if (!roleLocked) {
      setSystemPrompt(BASE_SYSTEM_PROMPTS[next]);
      setAccent(ROLE_META[next].accent);
    }
  };

  const changeProvider = (next: ProviderId) => {
    setProvider(next);
    const first = modelsByProvider(next)[0];
    if (first) setModel(first.id);
  };

  const submit = () => {
    const cleanName = name.trim();
    const cleanPrompt = systemPrompt.trim();
    if (cleanName.length === 0) {
      setLocalError('Give this agent a name.');
      return;
    }
    if (cleanPrompt.length < 20) {
      setLocalError('The system prompt must be at least 20 characters.');
      return;
    }
    if (!selectedModel) {
      setLocalError('Choose a model that belongs to the selected provider.');
      return;
    }
    const parsedTokens = Number.parseInt(maxTokens, 10);
    if (!Number.isFinite(parsedTokens) || parsedTokens < 256 || parsedTokens > 64_000) {
      setLocalError('Max tokens must be between 256 and 64,000.');
      return;
    }
    setLocalError(null);
    void onSubmit({
      name: cleanName,
      role,
      provider,
      model,
      systemPrompt: cleanPrompt,
      temperature: Number(temperature),
      maxTokens: parsedTokens,
      accent,
      enabled,
    });
  };

  return (
    <View style={styles.stack}>
      <Input
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Scout"
        autoCapitalize="words"
        leftIcon="person-outline"
      />

      <View style={styles.field}>
        <Text variant="label">Role</Text>
        {roleLocked ? (
          <View style={styles.lockedRole}>
            <Badge label={roleMeta.label} tone="lavender" />
            <Text variant="caption" tone="tertiary" style={styles.flexText}>
              Roles cannot change after creation. Create a new agent for a different role.
            </Text>
          </View>
        ) : (
          <Segmented options={ROLE_OPTIONS} value={role} onChange={changeRole} scrollable />
        )}
        <Text variant="caption" tone="tertiary">
          {roleMeta.description}
        </Text>
      </View>

      <View style={styles.field}>
        <Text variant="label">Provider</Text>
        <Segmented
          options={PROVIDERS.map((item) => ({
            label: PROVIDER_META[item].label,
            value: item,
          }))}
          value={provider}
          onChange={changeProvider}
        />
      </View>

      <View style={styles.field}>
        <SectionHeader title="Model" subtitle="Pricing is per million tokens" />
        <View style={styles.modelList}>
          {providerModels.map((item) => {
            const active = item.id === model;
            return (
              <Pressable
                key={item.id}
                onPress={() => setModel(item.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.model,
                  active && styles.modelActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.modelTop}>
                  <Text variant="bodyMedium" tone={active ? 'primary' : 'secondary'}>
                    {item.label}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark-circle" size={16} color={colors.ice} />
                  ) : null}
                </View>
                <Text variant="caption" tone="tertiary" numberOfLines={2}>
                  {item.description}
                </Text>
                <View style={styles.modelMeta}>
                  <Text variant="monoSmall" tone="faint">
                    ${item.inputPrice}/M in · ${item.outputPrice}/M out
                  </Text>
                  <Text variant="monoSmall" tone="faint">
                    {formatTokens(item.contextWindow)} ctx
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Input
        label="System prompt"
        value={systemPrompt}
        onChangeText={setSystemPrompt}
        placeholder="Describe exactly how this agent should behave."
        multiline
        hint={`${systemPrompt.trim().length} characters · minimum 20`}
      />

      <View style={styles.field}>
        <Text variant="label">Temperature</Text>
        <Segmented
          options={TEMPERATURE_OPTIONS}
          value={temperature}
          onChange={setTemperature}
          size="sm"
        />
      </View>

      <Input
        label="Max output tokens"
        value={maxTokens}
        onChangeText={setMaxTokens}
        keyboardType="number-pad"
        mono
        hint="Between 256 and 64,000"
      />

      <View style={styles.field}>
        <Text variant="label">Accent</Text>
        <View style={styles.accentRow}>
          {ACCENTS.map((color) => (
            <Pressable
              key={color}
              onPress={() => setAccent(color)}
              accessibilityRole="button"
              accessibilityLabel={`Use accent ${color}`}
              style={[
                styles.swatch,
                { backgroundColor: color },
                accent === color && styles.swatchActive,
              ]}
            />
          ))}
        </View>
      </View>

      <SwitchRow
        label="Enabled"
        description="Disabled agents are skipped when a new run builds its lineup."
        value={enabled}
        onValueChange={setEnabled}
      />

      {localError || error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text variant="caption" tone="danger" style={styles.flexText}>
            {localError ?? error}
          </Text>
        </View>
      ) : null}

      <Button
        label={submitLabel}
        fullWidth
        size="lg"
        loading={busy}
        onPress={submit}
        style={styles.submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space.xl,
  },
  field: {
    gap: space.sm,
  },
  flexText: {
    flex: 1,
  },
  lockedRole: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modelList: {
    gap: space.sm,
  },
  model: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    padding: space.md,
    gap: space.xs,
  },
  modelActive: {
    borderColor: 'rgba(168,199,250,0.4)',
    backgroundColor: 'rgba(168,199,250,0.06)',
  },
  modelTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  modelMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: 2,
  },
  accentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    opacity: 0.85,
  },
  swatchActive: {
    opacity: 1,
    borderWidth: 3,
    borderColor: colors.surface,
    transform: [{ scale: 1.12 }],
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  submit: {
    marginTop: space.sm,
  },
  pressed: {
    opacity: 0.75,
  },
});
