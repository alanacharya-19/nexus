import { StyleSheet, View } from 'react-native';
import { colors, radius, space, useAccent } from '@/theme';
import { Text } from '@/components/ui/text';

/**
 * The NEXUS wordmark. The accent bar is the single piece of brand chrome that
 * follows the user's chosen interface accent.
 */
export function BrandMark({
  size = 'md',
  subtitle,
}: {
  size?: 'sm' | 'md' | 'lg';
  subtitle?: string;
}) {
  const accent = useAccent();
  const fontSize = size === 'lg' ? 26 : size === 'sm' ? 14 : 18;

  return (
    <View style={styles.wrap} accessibilityLabel="NEXUS">
      <View style={styles.row}>
        <View
          style={[
            styles.mark,
            {
              width: fontSize * 0.42,
              height: fontSize * 0.42,
              backgroundColor: accent.accent,
              shadowColor: accent.accent,
            },
          ]}
        />
        <Text
          style={[
            styles.word,
            {
              fontSize,
              lineHeight: fontSize * 1.15,
              letterSpacing: size === 'lg' ? 5 : 3.2,
            },
          ]}
        >
          NEXUS
        </Text>
      </View>
      {subtitle ? (
        <Text variant="caption" tone="faint" style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  mark: {
    borderRadius: radius.xs,
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  word: {
    fontFamily: 'SpaceGrotesk_700Bold',
    color: colors.text,
  },
  subtitle: {
    marginLeft: 2,
  },
});
