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

export function isValidSyncKey(s: string | null | undefined): s is string {
  return typeof s === 'string' && KEY_FORMAT_RE.test(s);
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
  await setMeta(SETTINGS_KEY, { ...stored, syncKey: null, lastSyncAt: null });
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
