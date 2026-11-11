import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius, space, useHapticsEnabled } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface IconButtonProps {
  icon: IconName;
  onPress: () => void;
  size?: number;
  tone?: 'default' | 'muted' | 'danger' | 'inverse';
  variant?: 'ghost' | 'surface';
  disabled?: boolean;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  onPress,
  size = 18,
  tone = 'default',
  variant = 'ghost',
  disabled = false,
  accessibilityLabel,
  style,
}: IconButtonProps) {
  const hapticsEnabled = useHapticsEnabled();
  const color =
    tone === 'danger'
      ? colors.danger
      : tone === 'muted'
        ? colors.textTertiary
        : tone === 'inverse'
          ? colors.inverse
          : colors.text;

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        if (hapticsEnabled) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onPress();
      }}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.base,
        variant === 'surface' && styles.surface,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  surface: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfaceHigh,
  },
  disabled: {
    opacity: 0.35,
  },
});

export const iconButtonSpace = space;
