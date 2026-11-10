import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '@/theme';
import { Text } from './text';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface StatProps {
  label: string;
  value: string;
  detail?: string;
  icon?: IconName;
  accent?: string;
}

export function Stat({ label, value, detail, icon, accent = colors.textSecondary }: StatProps) {
  return (
    <View style={styles.stat}>
      <View style={styles.top}>
        <Text variant="label">{label}</Text>
        {icon ? <Ionicons name={icon} size={13} color={accent} /> : null}
      </View>
      <Text variant="heading" style={styles.value}>
        {value}
      </Text>
      {detail ? (
        <Text variant="caption" tone="tertiary">
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stat: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 3,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  value: {
    fontSize: 19,
    lineHeight: 24,
  },
});
