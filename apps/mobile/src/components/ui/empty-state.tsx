import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space } from '@/theme';
import { Button } from './button';
import { Text } from './text';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon = 'sparkles-outline',
  title,
  description,
  actionLabel,
  onAction,
  children,
  compact = false,
}: EmptyStateProps) {
  return (
    <View style={[styles.wrapper, compact && styles.compact]}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={22} color={colors.textSecondary} />
      </View>
      <Text variant="subheading" align="center">
        {title}
      </Text>
      <Text variant="body" align="center" tone="tertiary" style={styles.description}>
        {description}
      </Text>
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          variant="secondary"
          size="sm"
          style={styles.action}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.huge,
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  compact: {
    paddingVertical: space.xxl,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  description: {
    maxWidth: 320,
  },
  action: {
    marginTop: space.md,
  },
});
