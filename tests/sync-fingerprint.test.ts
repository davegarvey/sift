import { describe, it, expect, afterEach, vi } from 'vitest';
import { fingerprintSyncKey } from '../src/sync/key';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function isCrockford(s: string): boolean {
  return s.length === 4 && [...s].every((c) => CROCKFORD.includes(c));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fingerprintSyncKey', () => {
  it('is deterministic for the same key', async () => {
    const key = 'aB3_xY9-qW1eR4tZ7uI2oP0n';
    expect(await fingerprintSyncKey(key)).toBe(await fingerprintSyncKey(key));
  });

  it('produces 4 Crockford base32 characters', async () => {
    const fp = await fingerprintSyncKey('aB3_xY9-qW1eR4tZ7uI2oP0n');
    expect(fp).toHaveLength(4);
    expect(isCrockford(fp)).toBe(true);
  });

  it('differs for different keys', async () => {
    const a = await fingerprintSyncKey('aB3_xY9-qW1eR4tZ7uI2oP0n');
    const b = await fingerprintSyncKey('bC4_yZ0-rX2fS5uA8vJ3pQ1m');
    expect(a).not.toBe(b);
  });

  it('does not contain ambiguous characters (I, L, O, U)', async () => {
    for (let i = 0; i < 20; i++) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const fp = await fingerprintSyncKey(key);
      expect(fp).not.toMatch(/[ILOU]/);
    }
  });

  it('rejects when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', { subtle: undefined });
    await expect(fingerprintSyncKey('aB3_xY9-qW1eR4tZ7uI2oP0n')).rejects.toThrow();
  });
});
