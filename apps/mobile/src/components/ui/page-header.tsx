import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from '@/theme';
import { IconButton } from './icon-button';
import { Text } from './text';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  right?: ReactNode;
  back?: boolean;
  large?: boolean;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  right,
  back = false,
  large = false,
}: PageHeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.wrapper, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {back ? (
            <IconButton
              icon="chevron-back"
              onPress={() => router.back()}
              accessibilityLabel="Go back"
              tone="muted"
              style={styles.back}
            />
          ) : null}
          <View style={styles.titles}>
            {eyebrow ? (
              <Text variant="label" tone="tertiary">
                {eyebrow}
              </Text>
            ) : null}
            <Text variant={large ? 'title' : 'heading'} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" tone="tertiary" numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    backgroundColor: colors.bg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: 40,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
  },
  back: {
    marginLeft: -space.sm,
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
});
