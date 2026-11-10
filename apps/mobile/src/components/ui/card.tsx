import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space } from '@/theme';

interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  tone?: 'default' | 'raised' | 'flat' | 'danger';
  accessibilityLabel?: string;
}

export function Card({
  children,
  onPress,
  style,
  padded = true,
  tone = 'default',
  accessibilityLabel,
}: CardProps) {
  const content = (
    <View
      style={[
        styles.card,
        tone === 'raised' && styles.raised,
        tone === 'flat' && styles.flat,
        tone === 'danger' && styles.danger,
        padded && styles.padded,
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  raised: {
    backgroundColor: colors.surfaceRaised,
  },
  flat: {
    backgroundColor: colors.bgElevated,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: 'rgba(242,122,122,0.25)',
  },
  padded: {
    padding: space.lg,
  },
  pressed: {
    opacity: 0.72,
  },
});
