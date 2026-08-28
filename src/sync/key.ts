/**
 * Sync key generation, validation, and persistence.
 *
 * The key is the user's identity for sync. It's 16 random bytes encoded
 * as base64url (22 characters). Stored in IndexedDB meta under `syncKey`.
 *
 * The server validates keys against `KEY_FORMAT_RE = /^[A-Za-z0-9_-]{22}$/`.
 * The same regex is mirrored here for client-side validation.
 */

const KEY_FORMAT_RE = /^[A-Za-z0-9_-]{22}$/;

/** Crockford base32 alphabet (0-9 and A-Z minus I, L, O, U). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function isValidSyncKey(s: string | null | undefined): s is string {
  return typeof s === 'string' && KEY_FORMAT_RE.test(s);
}

/**
 * Display-only group fingerprint: the first 20 bits of the SHA-256 digest of
 * the sync key, rendered as 4 Crockford base32 characters (e.g. "XK7B").
 * One-way over a 132-bit random key, so it leaks nothing recoverable.
 * Rejects if the Web Crypto API is unavailable (insecure context).
 */
export async function fingerprintSyncKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const bytes = new Uint8Array(digest);
  const value = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) & 0xFFFFF;
  return (
    CROCKFORD[(value >> 15) & 31] +
    CROCKFORD[(value >> 10) & 31] +
    CROCKFORD[(value >> 5) & 31] +
    CROCKFORD[value & 31]
  );
}

export function generateSyncKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

import { getMeta, setMeta } from '../db/meta';
import type { AppSettings } from '../db/types';

const SETTINGS_KEY = 'settings';

export async function getStoredSyncKey(): Promise<string | null> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  const key = stored.syncKey ?? null;
  return isValidSyncKey(key) ? key : null;
}

export async function setStoredSyncKey(key: string): Promise<void> {
  if (!isValidSyncKey(key)) {
    throw new Error('Invalid sync key format');
  }
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  await setMeta(SETTINGS_KEY, { ...stored, syncKey: key });
}

export async function clearStoredSyncKey(): Promise<void> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  await setMeta(SETTINGS_KEY, { ...stored, syncKey: null });
}

export async function getStoredLastSyncAt(): Promise<number | null> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  const v = stored.lastSyncAt;
  return typeof v === 'number' ? v : null;
}

export async function setStoredLastSyncAt(value: number | null): Promise<void> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  await setMeta(SETTINGS_KEY, { ...stored, lastSyncAt: value });
}

export async function getStoredLastStatsSyncAt(): Promise<number | null> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  const v = stored.lastStatsSyncAt;
  return typeof v === 'number' ? v : null;
}

export async function setStoredLastStatsSyncAt(value: number | null): Promise<void> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  await setMeta(SETTINGS_KEY, { ...stored, lastStatsSyncAt: value });
}

export async function getStoredServerOffset(): Promise<number> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  const v = stored.serverOffset;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export async function setStoredServerOffset(value: number | null): Promise<void> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  await setMeta(SETTINGS_KEY, { ...stored, serverOffset: value });
}
