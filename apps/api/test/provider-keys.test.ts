import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderId } from '@nexus/shared';

const mocks = vi.hoisted(() => ({
  getCredential: vi.fn(),
  listCredentials: vi.fn(),
  upsertCredential: vi.fn(),
  deleteCredential: vi.fn(),
  config: {
    credentialKey: 'test-credential-encryption-secret',
    providerKeys: {
      openai: null as string | null,
      anthropic: null as string | null,
      google: null as string | null,
    },
    baseUrls: {
      openai: 'https://api.openai.com',
      anthropic: 'https://api.anthropic.com',
      google: 'https://generativelanguage.googleapis.com',
    },
    providerTimeoutMs: 30_000,
    providerMaxRetries: 0,
  },
}));

vi.mock('../src/config.js', () => ({ config: mocks.config }));

vi.mock('../src/repositories/credentials.js', () => ({
  getCredential: mocks.getCredential,
  listCredentials: mocks.listCredentials,
  upsertCredential: mocks.upsertCredential,
  deleteCredential: mocks.deleteCredential,
}));

const { getProviderKey } = await import('../src/providers/service.js');
const { encryptSecret } = await import('../src/security/crypto.js');

const userId = '11111111-1111-1111-1111-111111111111';

function storedCredential(provider: ProviderId, apiKey: string) {
  return {
    id: 'credential-id',
    userId,
    provider,
    encryptedKey: encryptSecret(apiKey),
    keyHint: `...${apiKey.slice(-4)}`,
    lastValidatedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  mocks.getCredential.mockReset();
  mocks.listCredentials.mockReset();
  mocks.getCredential.mockResolvedValue(null);
  mocks.listCredentials.mockResolvedValue([]);
  mocks.config.providerKeys.openai = null;
  mocks.config.providerKeys.anthropic = null;
  mocks.config.providerKeys.google = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getProviderKey', () => {
  it('prefers a personal device key and never reads stored credentials', async () => {
    mocks.getCredential.mockResolvedValue(storedCredential('openai', 'sk-stored'));

    await expect(getProviderKey(userId, 'openai', 'sk-device')).resolves.toEqual({
      key: 'sk-device',
      source: 'device',
    });
    expect(mocks.getCredential).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from a device key', async () => {
    await expect(getProviderKey(userId, 'openai', '  sk-device  ')).resolves.toEqual({
      key: 'sk-device',
      source: 'device',
    });
  });

  it('ignores a blank device key and falls back to the stored credential', async () => {
    mocks.getCredential.mockResolvedValue(storedCredential('anthropic', 'sk-ant-stored'));

    await expect(getProviderKey(userId, 'anthropic', '   ')).resolves.toEqual({
      key: 'sk-ant-stored',
      source: 'user',
    });
  });

  it('decrypts the per-user encrypted credential when no device key is sent', async () => {
    mocks.getCredential.mockResolvedValue(storedCredential('google', 'goog-stored'));

    await expect(getProviderKey(userId, 'google', null)).resolves.toEqual({
      key: 'goog-stored',
      source: 'user',
    });
  });

  it('falls back to a server-managed provider key', async () => {
    mocks.config.providerKeys.openai = 'sk-server';

    await expect(getProviderKey(userId, 'openai')).resolves.toEqual({
      key: 'sk-server',
      source: 'server',
    });
    expect(mocks.getCredential).toHaveBeenCalledWith(userId, 'openai');
  });

  it('rejects with a configuration error when no key exists anywhere', async () => {
    await expect(getProviderKey(userId, 'google')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
      statusCode: 424,
    });
  });

  it('prefers a stored user credential over the server key', async () => {
    mocks.getCredential.mockResolvedValue(storedCredential('openai', 'sk-user'));
    mocks.config.providerKeys.openai = 'sk-server';

    await expect(getProviderKey(userId, 'openai')).resolves.toEqual({
      key: 'sk-user',
      source: 'user',
    });
  });
});
