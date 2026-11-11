import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  colors,
  motion,
  radius,
  space,
  useAccent,
  useHapticsEnabled,
  useReduceMotion,
} from '@/theme';
import { Text } from './text';

type IconName = ComponentProps<typeof Ionicons>['name'];
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  fullWidth = false,
  haptic = true,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const accent = useAccent();
  const reduceMotion = useReduceMotion();
  const hapticsEnabled = useHapticsEnabled();
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;
  const foreground =
    variant === 'primary'
      ? accent.onAccent
      : variant === 'danger'
        ? colors.danger
        : variant === 'ghost'
          ? colors.textSecondary
          : colors.text;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (isDisabled) return;
    if (haptic && hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    onPress();
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => {
        if (!reduceMotion) scale.set(withSpring(0.975, motion.spring));
      }}
      onPressOut={() => {
        if (!reduceMotion) scale.set(withSpring(1, motion.spring));
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        styles.base,
        size === 'sm' && styles.sm,
        size === 'lg' && styles.lg,
        variant === 'primary' && { backgroundColor: accent.accent },
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        variant === 'outline' && styles.outline,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        animatedStyle,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <View style={styles.content}>
          {icon && iconPosition === 'left' ? (
            <Ionicons name={icon} size={size === 'sm' ? 14 : 16} color={foreground} />
          ) : null}
          <Text
            variant={size === 'sm' ? 'caption' : 'bodySemibold'}
            color={foreground}
            style={styles.label}
            numberOfLines={1}
          >
            {label}
          </Text>
          {icon && iconPosition === 'right' ? (
            <Ionicons name={icon} size={size === 'sm' ? 14 : 16} color={foreground} />
          ) : null}
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 46,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
  },
  sm: {
    minHeight: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  lg: {
    minHeight: 54,
    paddingHorizontal: space.xxl,
    borderRadius: radius.lg,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  label: {
    letterSpacing: 0.1,
  },
  secondary: {
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  ghost: {
    backgroundColor: colors.transparent,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(242,122,122,0.28)',
  },
  outline: {
    backgroundColor: colors.transparent,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  disabled: {
    opacity: 0.4,
  },
});
