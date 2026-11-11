import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, useReduceMotion } from '@/theme';

/**
 * Small, composable motion primitives. They intentionally stay close to the
 * NEXUS motion language: short fades, gentle lifts, and a single pulsing signal.
 */

export function Appear({
  children,
  delay = 0,
  style,
  lift = true,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  lift?: boolean;
}) {
  const reduceMotion = useReduceMotion();
  if (reduceMotion) return <View style={style}>{children}</View>;
  const entering = lift
    ? FadeInDown.delay(delay).springify().damping(20)
    : FadeIn.delay(delay).duration(220);
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}

export function StatusDot({
  color = colors.mint,
  active = true,
  size = 6,
}: {
  color?: string;
  active?: boolean;
  size?: number;
}) {
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!active || reduceMotion) {
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 1600 }), -1, false);
    return () => {
      pulse.value = 0;
    };
  }, [active, reduceMotion, pulse]);

  const ring = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value) * 0.5,
    transform: [{ scale: 1 + pulse.value * 2.2 }],
  }));

  return (
    <View style={[styles.dotWrap, { width: size * 3, height: size * 3 }]}>
      <Animated.View
        style={[
          styles.ring,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          ring,
        ]}
      />
      <View
        style={[
          styles.core,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        ]}
      />
    </View>
  );
}

const DOT_DELAYS = [0, 160, 320];

export function StreamingDots({ color = colors.textTertiary }: { color?: string }) {
  const reduceMotion = useReduceMotion();
  const dotA = useSharedValue(0.35);
  const dotB = useSharedValue(0.35);
  const dotC = useSharedValue(0.35);
  const dotStyleA = useAnimatedStyle(() => ({ opacity: dotA.value }));
  const dotStyleB = useAnimatedStyle(() => ({ opacity: dotB.value }));
  const dotStyleC = useAnimatedStyle(() => ({ opacity: dotC.value }));

  useEffect(() => {
    if (reduceMotion) return;
    const dots = [dotA, dotB, dotC];
    dots.forEach((dot, index) => {
      dot.value = withDelay(
        DOT_DELAYS[index],
        withRepeat(
          withSequence(
            withTiming(1, { duration: 420 }),
            withTiming(0.28, { duration: 420 })
          ),
          -1,
          true
        )
      );
    });
    // Shared values are stable for the lifetime of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const dotStyles = [dotStyleA, dotStyleB, dotStyleC];

  return (
    <View style={styles.streamRow} accessibilityLabel="Agent is working">
      {dotStyles.map((animated, index) => (
        <Animated.View
          key={index}
          style={[styles.streamDot, { backgroundColor: color }, animated]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dotWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
  },
  core: {
    position: 'absolute',
  },
  streamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  streamDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
});
