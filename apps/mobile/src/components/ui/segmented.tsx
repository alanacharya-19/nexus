import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { Text } from './text';

export interface SegmentOption<T extends string> {
  label: string;
  value: T;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  scrollable?: boolean;
  size?: 'sm' | 'md';
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  scrollable = false,
  size = 'md',
}: SegmentedProps<T>) {
  const content = (
    <View style={[styles.container, size === 'sm' && styles.containerSm]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.option,
              size === 'sm' && styles.optionSm,
              active && styles.optionActive,
              pressed && styles.pressed,
            ]}
          >
            {option.icon}
            <Text
              variant={size === 'sm' ? 'caption' : 'bodyMedium'}
              tone={active ? 'primary' : 'tertiary'}
              numberOfLines={1}
              style={active ? styles.activeLabel : undefined}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (!scrollable) return content;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingRight: space.xl,
  },
  container: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 3,
    gap: 2,
  },
  containerSm: {
    alignSelf: 'flex-start',
  },
  option: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
  },
  optionSm: {
    flex: 0,
    minHeight: 30,
    paddingHorizontal: space.md,
  },
  optionActive: {
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  activeLabel: {
    fontFamily: 'Inter_600SemiBold',
  },
  pressed: {
    opacity: 0.7,
  },
});
