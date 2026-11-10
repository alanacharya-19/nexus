import { Redirect, Stack } from 'expo-router';
import { colors } from '@/theme';
import { useAuthStore } from '@/stores/auth';

export default function AuthLayout() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const session = useAuthStore((state) => state.session);

  if (!hydrated) return null;
  if (session) return <Redirect href="/" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'fade',
      }}
    />
  );
}
