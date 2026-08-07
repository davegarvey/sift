import { webcrypto } from 'node:crypto';

/** Crockford base32 alphabet (0-9 and A-Z minus I, L, O, U). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Display fingerprint for a credential: SHA-256, first 20 bits rendered as
 * 4 uppercase Crockford characters — identical to the Sift server's scheme,
 * so `siftctl status` shows the same string as the Settings agents list.
 */
export async function tokenFingerprint(token: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const bytes = new Uint8Array(digest);
  const value = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) & 0xFFFFF;
  return (
    CROCKFORD[(value >> 15) & 31] +
    CROCKFORD[(value >> 10) & 31] +
    CROCKFORD[(value >> 5) & 31] +
    CROCKFORD[value & 31]
  );
}
