import type { ProviderId } from '@nexus/shared';
import { Platform } from 'react-native';
import { deleteSecret, getSecret, setSecret } from './secure-storage';

/**
 * Personal-key mode: the key stays in the OS secure store on this device and is
 * relayed to the API for a single authenticated request. It is never written to
 * AsyncStorage, SQLite, logs, or the app's ordinary cache.
 *
 * The web build has no OS keychain. Rather than silently falling back to
 * localStorage (plaintext), personal keys are disabled there; use a
 * server-managed key instead.
 */
const KEY_PREFIX = 'nexus.providerKey.';

function storageKey(provider: ProviderId): string {
  return `${KEY_PREFIX}${provider}`;
}

function assertSecureStoreAvailable(): void {
  if (Platform.OS === 'web') {
    throw new Error(
      'Personal provider keys require the native app secure store. On web, use a server-managed key in Settings → Providers.'
    );
  }
}

export async function getDeviceProviderKey(
  provider: ProviderId
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const value = await getSecret(storageKey(provider));
  return value?.trim() || null;
}

export async function setDeviceProviderKey(
  provider: ProviderId,
  apiKey: string
): Promise<void> {
  assertSecureStoreAvailable();
  await setSecret(storageKey(provider), apiKey.trim());
}

export async function deleteDeviceProviderKey(provider: ProviderId): Promise<void> {
  if (Platform.OS === 'web') return;
  await deleteSecret(storageKey(provider));
}

export async function listDeviceProviderKeys(): Promise<ProviderId[]> {
  if (Platform.OS === 'web') return [];
  const providers: ProviderId[] = ['openai', 'anthropic', 'google'];
  const found: ProviderId[] = [];
  for (const provider of providers) {
    if (await getDeviceProviderKey(provider)) found.push(provider);
  }
  return found;
}
