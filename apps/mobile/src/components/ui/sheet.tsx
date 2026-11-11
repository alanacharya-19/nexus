import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space, useReduceMotion } from '@/theme';
import { IconButton } from './icon-button';
import { Text } from './text';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  scrollable?: boolean;
}

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  scrollable = true,
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close sheet" />
        <Animated.View
          entering={
            reduceMotion
              ? FadeIn.duration(180)
              : SlideInDown.springify().damping(20).stiffness(190)
          }
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text variant="heading">{title}</Text>
              {subtitle ? (
                <Text variant="caption" tone="tertiary">
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <IconButton icon="close" onPress={onClose} accessibilityLabel="Close" tone="muted" />
          </View>
          {scrollable ? (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.bodyContent}>{children}</View>
          )}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    maxHeight: '90%',
    paddingTop: space.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHover,
    alignSelf: 'center',
    marginBottom: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    gap: space.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    gap: space.lg,
  },
  footer: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: space.sm,
  },
});
