import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadows, space } from '@/theme';
import { useToastStore, type ToastTone } from '@/stores/toast';
import { Text } from './text';

const toneMeta: Record<ToastTone, { icon: 'checkmark-circle' | 'alert-circle' | 'information-circle'; color: string }> = {
  default: { icon: 'information-circle', color: colors.ice },
  success: { icon: 'checkmark-circle', color: colors.mint },
  error: { icon: 'alert-circle', color: colors.danger },
};

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + space.sm }]}>
      {toasts.map((toast) => {
        const meta = toneMeta[toast.tone];
        return (
          <Pressable
            key={toast.id}
            onPress={() => dismiss(toast.id)}
            style={styles.toast}
            accessibilityRole="alert"
          >
            <Ionicons name={meta.icon} size={18} color={meta.color} />
            <View style={styles.content}>
              <Text variant="bodySemibold" style={styles.title}>
                {toast.title}
              </Text>
              {toast.description ? (
                <Text variant="caption" tone="secondary" numberOfLines={3}>
                  {toast.description}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    zIndex: 1000,
    gap: space.sm,
    alignItems: 'center',
  },
  toast: {
    width: '100%',
    maxWidth: 560,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: space.md,
    ...shadows.floating,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    lineHeight: 19,
  },
});
