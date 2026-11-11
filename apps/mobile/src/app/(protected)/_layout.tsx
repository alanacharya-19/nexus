import { Redirect, Stack } from 'expo-router';
import { colors } from '@/theme';
import { useAuthStore } from '@/stores/auth';

export default function ProtectedLayout() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const session = useAuthStore((state) => state.session);

  if (!hydrated) return null;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      <Stack.Screen name="run/new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="run/[id]" />
      <Stack.Screen name="workspace/[id]" />
      <Stack.Screen name="workflow/[id]" />
      <Stack.Screen name="artifact/[id]" />
      <Stack.Screen name="agents/new" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="agents/[id]" />
      <Stack.Screen name="usage" />
    </Stack>
  );
}
