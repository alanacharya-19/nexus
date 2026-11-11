import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@/theme';
import { initials } from '@/lib/format';
import { Text } from './text';

interface AvatarProps {
  name: string;
  accent?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({ name, accent = colors.ice, size = 36, style }: AvatarProps) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: `${accent}44`,
          backgroundColor: `${accent}18`,
        },
        style,
      ]}
    >
      <Text
        style={{
          color: accent,
          fontSize: Math.max(10, size * 0.32),
          fontFamily: 'Inter_600SemiBold',
          letterSpacing: 0.2,
        }}
      >
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
