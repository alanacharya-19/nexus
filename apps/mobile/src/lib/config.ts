import Constants from 'expo-constants';
import { Platform } from 'react-native';

const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

function devHostUrl(): string {
  if (Platform.OS === 'web') return 'http://localhost:4000/v1';
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
      ?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:4000/v1`;
  return 'http://localhost:4000/v1';
}

export const DEFAULT_API_URL = (envUrl || devHostUrl()).replace(/\/+$/, '');

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

export const APP_VERSION = '1.0.0';
