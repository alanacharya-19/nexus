import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '@/theme';
import { useOnline } from '@/hooks/use-online';
import { Text } from './text';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <View style={styles.banner}>
      <Ionicons name="cloud-offline-outline" size={14} color={colors.amber} />
      <Text variant="caption" tone="amber" style={styles.text}>
        Offline — showing saved data. Actions will fail until you reconnect.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.warningSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(231,196,138,0.24)',
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    marginHorizontal: space.xl,
    marginBottom: space.sm,
  },
  text: {
    flex: 1,
  },
});
