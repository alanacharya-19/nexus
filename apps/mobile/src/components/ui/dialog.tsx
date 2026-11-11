import type { ComponentProps, ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '@/theme';
import { Text } from './text';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface DialogProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: IconName;
  tone?: 'default' | 'danger';
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * Centered decision dialog for destructive or blocking confirmations. Bottom
 * sheets handle contextual input; dialogs handle "stop and decide" moments.
 */
export function Dialog({
  visible,
  onClose,
  title,
  description,
  icon,
  tone = 'default',
  children,
  footer,
}: DialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.fill}>
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={styles.backdropWrap}>
          <Pressable
            style={styles.backdrop}
            onPress={onClose}
            accessibilityLabel="Dismiss dialog"
          />
        </Animated.View>
        <Animated.View
          entering={ZoomIn.duration(200).springify().damping(20)}
          exiting={ZoomOut.duration(140)}
          style={styles.card}
        >
          <View style={styles.header}>
            {icon ? (
              <View style={[styles.icon, tone === 'danger' && styles.iconDanger]}>
                <Ionicons
                  name={icon}
                  size={20}
                  color={tone === 'danger' ? colors.danger : colors.ice}
                />
              </View>
            ) : null}
            <View style={styles.headerText}>
              <Text variant="heading">{title}</Text>
              {description ? (
                <Text variant="caption" tone="tertiary">
                  {description}
                </Text>
              ) : null}
            </View>
          </View>
          {children ? <View style={styles.body}>{children}</View> : null}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  backdropWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    padding: space.xl,
    gap: space.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(168,199,250,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(168,199,250,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: 'rgba(242,122,122,0.26)',
  },
  headerText: {
    flex: 1,
    gap: space.xs,
  },
  body: {
    gap: space.md,
  },
  footer: {
    gap: space.sm,
  },
});
