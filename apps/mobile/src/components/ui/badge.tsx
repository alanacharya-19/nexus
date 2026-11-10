import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, space } from '@/theme';
import { Text } from './text';

type BadgeTone = 'neutral' | 'ice' | 'mint' | 'amber' | 'coral' | 'danger' | 'lavender';

const tones: Record<BadgeTone, { bg: string; fg: string; border: string }> = {
  neutral: {
    bg: colors.surfaceHigh,
    fg: colors.textSecondary,
    border: colors.border,
  },
  ice: { bg: 'rgba(168,199,250,0.10)', fg: colors.ice, border: 'rgba(168,199,250,0.22)' },
  mint: { bg: 'rgba(183,241,113,0.10)', fg: colors.mint, border: 'rgba(183,241,113,0.22)' },
  amber: { bg: 'rgba(231,196,138,0.10)', fg: colors.amber, border: 'rgba(231,196,138,0.22)' },
  coral: { bg: 'rgba(242,163,140,0.10)', fg: colors.coral, border: 'rgba(242,163,140,0.22)' },
  danger: { bg: colors.dangerSurface, fg: colors.danger, border: 'rgba(242,122,122,0.24)' },
  lavender: {
    bg: 'rgba(201,196,242,0.10)',
    fg: colors.lavender,
    border: 'rgba(201,196,242,0.22)',
  },
};

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  dot?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'neutral', dot = false, icon, style }: BadgeProps) {
  const palette = tones[tone];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: palette.bg, borderColor: palette.border },
        style,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: palette.fg }]} /> : null}
      {icon}
      <Text variant="caption" color={palette.fg} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs + 1,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  label: {
    fontFamily: undefined,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.2,
  },
});
