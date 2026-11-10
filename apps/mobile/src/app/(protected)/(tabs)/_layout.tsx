import { forwardRef, type ComponentRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  TabList,
  TabSlot,
  TabTrigger,
  Tabs,
  type TabListProps,
  type TabTriggerSlotProps,
} from 'expo-router/ui';
import { colors, layout, radius, shadows, space } from '@/theme';
import { Text } from '@/components/ui/text';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabButtonProps extends TabTriggerSlotProps {
  icon: IconName;
  activeIcon: IconName;
  label: string;
}

const TabButton = forwardRef<ComponentRef<typeof Pressable>, TabButtonProps>(
  function TabButton({ icon, activeIcon, label, isFocused, children: _children, ...props }, ref) {
    const color = isFocused ? colors.text : colors.textTertiary;
    return (
      <Pressable
        ref={ref}
        {...props}
        accessibilityRole="tab"
        accessibilityState={{ selected: isFocused }}
        style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
      >
        <View style={styles.iconWrap}>
          <Ionicons name={isFocused ? activeIcon : icon} size={20} color={color} />
          {isFocused ? <View style={styles.activeDot} /> : null}
        </View>
        <Text
          style={[
            styles.label,
            { color },
            isFocused && styles.labelActive,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    );
  }
);

function TabBar({ children, ...props }: TabListProps & { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      {...props}
      style={[
        styles.barWrapper,
        { bottom: Math.max(insets.bottom, space.md) },
      ] as ViewStyle}
      pointerEvents="box-none"
    >
      <View style={styles.bar}>{children}</View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        <TabBar>
          <TabTrigger name="index" href="/" asChild>
            <TabButton icon="pulse-outline" activeIcon="pulse" label="Command" />
          </TabTrigger>
          <TabTrigger name="runs" href="/runs" asChild>
            <TabButton icon="layers-outline" activeIcon="layers" label="Runs" />
          </TabTrigger>
          <TabTrigger name="agents" href="/agents" asChild>
            <TabButton icon="people-outline" activeIcon="people" label="Agents" />
          </TabTrigger>
          <TabTrigger name="library" href="/library" asChild>
            <TabButton icon="albums-outline" activeIcon="albums" label="Library" />
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TabButton icon="options-outline" activeIcon="options" label="Settings" />
          </TabTrigger>
        </TabBar>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  barWrapper: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    alignItems: 'center',
    zIndex: 50,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: layout.maxWidth,
    height: layout.tabBarHeight,
    paddingHorizontal: space.xs,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(14,16,20,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    ...shadows.floating,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: '100%',
    borderRadius: radius.lg,
  },
  tabPressed: {
    opacity: 0.65,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 22,
  },
  activeDot: {
    position: 'absolute',
    bottom: -3,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.ice,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.1,
  },
  labelActive: {
    fontFamily: 'Inter_600SemiBold',
  },
});
