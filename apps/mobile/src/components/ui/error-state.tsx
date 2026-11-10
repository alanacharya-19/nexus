import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { Button } from './button';
import { Text } from './text';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  compact = false,
}: ErrorStateProps) {
  return (
    <View style={[styles.wrapper, compact && styles.compact]}>
      <View style={styles.iconWrap}>
        <View style={styles.iconDot} />
      </View>
      <Text variant="subheading" align="center">
        {title}
      </Text>
      <Text variant="body" align="center" tone="tertiary" style={styles.message}>
        {message}
      </Text>
      {onRetry ? (
        <Button
          label="Try again"
          icon="refresh"
          onPress={onRetry}
          variant="secondary"
          size="sm"
          style={styles.action}
        />
      ) : null}
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
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(242,122,122,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  iconDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.danger,
  },
  message: {
    maxWidth: 320,
  },
  action: {
    marginTop: space.md,
  },
});
