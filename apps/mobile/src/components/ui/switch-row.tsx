import { StyleSheet, Switch, View } from 'react-native';
import { colors, radius, space, useAccent } from '@/theme';
import { Text } from './text';

interface SwitchRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: SwitchRowProps) {
  const accent = useAccent();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text variant="bodyMedium">{label}</Text>
        {description ? (
          <Text variant="caption" tone="tertiary">
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.surfaceHigh, true: accent.border }}
        thumbColor={value ? accent.accent : colors.textTertiary}
        ios_backgroundColor={colors.surfaceHigh}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    minHeight: 52,
    paddingVertical: space.sm,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});

export const switchRowStyle = { radius };
