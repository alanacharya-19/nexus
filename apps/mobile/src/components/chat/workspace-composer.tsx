import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, useAccent } from '@/theme';
import { Text } from '@/components/ui/text';

interface WorkspaceComposerProps {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  onAttach?: () => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  loading?: boolean;
}

export function WorkspaceComposer({
  value,
  onChangeText,
  onSend,
  onAttach,
  busy = false,
  disabled = false,
  placeholder = 'Steer the workspace — add context, change direction, raise the bar…',
  hint,
  loading = false,
}: WorkspaceComposerProps) {
  const accent = useAccent();
  const canSend = !disabled && !busy && value.trim().length > 0;

  return (
    <View style={styles.wrap}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        multiline
        editable={!disabled}
        style={styles.input}
        selectionColor={accent.accent}
        accessibilityLabel="Workspace instruction"
      />
      <View style={styles.footer}>
        <Pressable
          onPress={onAttach}
          disabled={!onAttach || disabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add context"
          style={({ pressed }) => [
            styles.attach,
            pressed && styles.pressed,
            (!onAttach || disabled) && styles.disabled,
          ]}
        >
          <Ionicons name="attach" size={18} color={colors.textTertiary} />
        </Pressable>
        <Text variant="caption" tone="faint" numberOfLines={1} style={styles.hint}>
          {hint ?? (disabled ? 'This workspace is closed.' : 'Applied at the next safe point')}
        </Text>
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send instruction"
          accessibilityState={{ disabled: !canSend, busy }}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: canSend ? accent.accent : colors.surfaceHigh },
            pressed && canSend && styles.pressed,
          ]}
        >
          <Ionicons
            name={busy ? 'ellipsis-horizontal' : 'arrow-up'}
            size={18}
            color={canSend ? accent.onAccent : colors.textFaint}
          />
        </Pressable>
      </View>
      {loading ? (
        <Text variant="caption" tone="faint">
          Restoring your draft…
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
  },
  input: {
    minHeight: 44,
    maxHeight: 132,
    color: colors.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  attach: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  hint: {
    flex: 1,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.4,
  },
});
