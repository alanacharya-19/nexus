import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '@/theme';
import { Text } from './text';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconColor?: string;
  value?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  showDivider?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconColor = colors.textSecondary,
  value,
  trailing,
  onPress,
  showDivider = false,
  danger = false,
  disabled = false,
}: ListRowProps) {
  const content = (
    <View style={[styles.row, showDivider && styles.divider]}>
      {icon ? (
        <View style={[styles.icon, danger && styles.iconDanger]}>
          <Ionicons
            name={icon}
            size={16}
            color={danger ? colors.danger : iconColor}
          />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text variant="bodyMedium" tone={danger ? 'danger' : undefined} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="tertiary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="caption" tone="tertiary" numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {onPress ? (
        <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 58,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: 'rgba(242,122,122,0.24)',
  },
  text: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  value: {
    maxWidth: 140,
  },
  pressed: {
    backgroundColor: colors.surfaceHover,
  },
  disabled: {
    opacity: 0.45,
  },
});
