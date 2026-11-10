import type { ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, space } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export function Screen({ children, style, padded = false }: ScreenProps) {
  return (
    <View style={[styles.screen, padded && styles.padded, style]}>{children}</View>
  );
}

interface ScrollScreenProps extends ScreenProps {
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomPadding?: number;
  keyboardShouldPersistTaps?: 'always' | 'handled' | 'never';
}

export function ScrollScreen({
  children,
  style,
  padded = true,
  refreshing,
  onRefresh,
  bottomPadding,
  keyboardShouldPersistTaps = 'handled',
}: ScrollScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <Screen>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          padded && styles.padded,
          {
            paddingBottom: bottomPadding ?? insets.bottom + layout.tabBarHeight + space.xxl,
            maxWidth: layout.maxWidth,
            width: '100%',
            alignSelf: 'center',
          },
          style,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={Boolean(refreshing)}
              onRefresh={onRefresh}
              tintColor={colors.textSecondary}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
  },
});
