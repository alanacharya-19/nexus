import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '@/theme';
import { Text } from './text';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface ChipProps {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  icon?: IconName;
  tone?: 'default' | 'danger';
}

export function Chip({ label, onPress, selected = false, icon, tone = 'default' }: ChipProps) {
  const content = (
    <View
      style={[
        styles.chip,
        selected && styles.selected,
        tone === 'danger' && styles.danger,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={13}
          color={
            tone === 'danger'
              ? colors.danger
              : selected
                ? colors.text
                : colors.textTertiary
          }
        />
      ) : null}
      <Text
        variant="caption"
        tone={tone === 'danger' ? 'danger' : selected ? 'primary' : 'tertiary'}
        style={selected ? styles.selectedLabel : undefined}
      >
        {label}
      </Text>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 1,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  selected: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.borderStrong,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: 'rgba(242,122,122,0.25)',
  },
  selectedLabel: {
    fontFamily: 'Inter_600SemiBold',
  },
  pressed: {
    opacity: 0.7,
  },
});
