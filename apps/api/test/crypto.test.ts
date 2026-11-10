import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  keyHint,
} from '../src/security/crypto.js';

describe('credential encryption', () => {
  it('round-trips a secret', () => {
    const secret = 'sk-test-1234567890abcdef';
    const payload = encryptSecret(secret);
    expect(payload).not.toContain(secret);
    expect(payload.startsWith('v1.')).toBe(true);
    expect(decryptSecret(payload)).toBe(secret);
  });

  it('produces a different payload each time (random IV)', () => {
    const secret = 'sk-test-1234567890abcdef';
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it('rejects tampered payloads', () => {
    const payload = encryptSecret('sk-test-1234567890abcdef');
    const parts = payload.split('.');
    const data = parts[3]!;
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${data.slice(0, -2)}AA`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects unsupported payload versions', () => {
    expect(() => decryptSecret('v2.aaa.bbb.ccc')).toThrow(/Unsupported/);
    expect(() => decryptSecret('not-a-payload')).toThrow(/Unsupported/);
  });

  it('builds a safe key hint', () => {
    expect(keyHint('short')).toBe('••••');
    expect(keyHint('sk-test-1234567890abcdef')).toBe('••••cdef');
  });
});
