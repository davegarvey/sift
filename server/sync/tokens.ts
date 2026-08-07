/**
 * Agent token primitives.
 *
 * Tokens are 23-character credentials beginning with `t` — deliberately
 * disjoint from master sync keys (exactly 22 characters, `KEY_FORMAT_RE`),
 * so a token can never be mistaken for a master key or accepted by
 * master-key-only paths.
 */

export const TOKEN_PREFIX = 't';
export const TOKEN_LEN = 23;
export const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Crockford base32 alphabet (0-9 and A-Z minus I, L, O, U). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function isValidTokenFormat(s: string): boolean {
  return s.length === TOKEN_LEN && s.startsWith(TOKEN_PREFIX) && /^[A-Za-z0-9_-]+$/.test(s);
}

export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_LEN - 1);
  crypto.getRandomValues(bytes);
  let s = TOKEN_PREFIX;
  for (const b of bytes) s += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return s;
}

export function generateTokenId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Crockford fingerprint of an arbitrary string: SHA-256, first 20 bits
 * rendered as 4 uppercase Crockford characters — byte-identical to the
 * browser's `fingerprintSyncKey` scheme so Settings and `siftctl` agree.
 */
async function crockfordFingerprint(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest);
  const value = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) & 0xFFFFF;
  return (
    CROCKFORD[(value >> 15) & 31] +
    CROCKFORD[(value >> 10) & 31] +
    CROCKFORD[(value >> 5) & 31] +
    CROCKFORD[value & 31]
  );
}

/** Display fingerprint for a token — matches the Settings agents list. */
export async function tokenFingerprint(token: string): Promise<string> {
  return crockfordFingerprint(token);
}

/** Display fingerprint for a sync key — the group code shown in Settings. */
export async function syncKeyFingerprint(syncKey: string): Promise<string> {
  return crockfordFingerprint(syncKey);
}
