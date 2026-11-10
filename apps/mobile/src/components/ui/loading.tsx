import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, space } from '@/theme';
import { Text } from './text';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="small" color={colors.textSecondary} />
      <Text variant="caption" tone="tertiary">
        {label}
      </Text>
    </View>
  );
}

export function Skeleton({
  height = 16,
  width = '100%',
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 850,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { height, width, opacity },
        style,
      ]}
    />
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: rows }).map((_, index) => (
        <View key={index} style={styles.skeletonCard}>
          <Skeleton height={12} width="42%" />
          <Skeleton height={18} width="82%" />
          <Skeleton height={10} width="60%" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    paddingVertical: space.huge,
    alignItems: 'center',
    gap: space.md,
  },
  skeleton: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
  },
  list: {
    gap: space.md,
  },
  skeletonCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
});
