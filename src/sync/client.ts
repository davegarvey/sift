/**
 * HTTP client for the sync API.
 *
 * - `register()` — POST /sync/register, idempotent.
 * - `rotateSyncKey()` — POST /sync/rotate, regenerate the sync key.
 * - `issueOtp()` — POST /sync/otp, returns the server-generated code.
 * - `redeemCode()` — POST /sync/redeem, returns the sync key.
 * - `pushDirty()` — POST /sync/push, returns ok or error.
 * - `pullSince()` — GET /sync/pull?since=…, returns server payload.
 *
 * Registration is explicit (pairing, enabling sync, rotation). A 401 is
 * never auto-recovered — a rotated or revoked key stays dead by design.
 * 413 (push) → split payload and retry.
 * 429 → respect Retry-After; fall back to exponential backoff.
 * 5xx / network → exponential backoff (1s, 2s, 5s, 10s, max 60s).
 */

import { isValidSyncKey } from './key';
import { getStoredSyncKey, setStoredSyncKey } from './key';

export const MAX_PUSH_BYTES = 1_000_000;
export const MAX_DIRTY_PER_PUSH = 500;
export const PULL_TIMEOUT_MS = 15_000;
export const PUSH_TIMEOUT_MS = 30_000;

export interface PullPayload {
  serverTime: number;
  feeds: unknown[];
  flags: unknown[];
}

export class SyncClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffDelay(attempt: number): number {
  return Math.min(60_000, [1000, 2000, 5000, 10_000][Math.min(attempt, 3)] ?? 10_000);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  maxAttempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts - 1) throw err;
      await sleep(backoffDelay(attempt));
    }
  }
  throw lastErr;
}

export async function register(): Promise<void> {
  const key = await getStoredSyncKey();
  if (!key) throw new SyncClientError('No sync key stored', 401);
  const res = await fetchWithTimeout(
    '/sync/register',
    { method: 'POST', headers: { 'X-Sync-Key': key } },
    PUSH_TIMEOUT_MS,
  );
  if (!res.ok && res.status !== 429 && res.status !== 503) {
    throw new SyncClientError(`Register failed: ${res.status}`, res.status);
  }
  if (res.status === 429 || res.status === 503) {
    const ra = Number(res.headers.get('Retry-After') ?? '60');
    throw new SyncClientError(`Register rate-limited: ${res.status}`, res.status, ra);
  }
}

/**
 * Regenerate the sync key (master-key auth). `oldKey` goes in the header
 * (it may already be replaced in storage when this is called); `newKey` in
 * the body. The server registers the new key and permanently deads the old
 * one — its agent tokens stop working and register refuses to resurrect it.
 */
export async function rotateSyncKey(oldKey: string, newKey: string): Promise<void> {
  const res = await fetchWithTimeout(
    '/sync/rotate',
    {
      method: 'POST',
      headers: { 'X-Sync-Key': oldKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_key: newKey }),
    },
    PUSH_TIMEOUT_MS,
  );
  if (!res.ok) throw new SyncClientError(`Rotate failed: ${res.status}`, res.status);
}

export async function issueOtp(): Promise<{ code: string; expiresAt: number }> {
  const key = await getStoredSyncKey();
  if (!key) throw new SyncClientError('No sync key stored', 401);
  return withRetry(async () => {
    let res = await fetchWithTimeout(
      '/sync/otp',
      { method: 'POST', headers: { 'X-Sync-Key': key } },
      PUSH_TIMEOUT_MS,
    );
    if (res.status === 401) {
      // Pairing is an explicit registration point. A key the server does
      // not know (fresh environment, cleared storage) is registered before
      // the code is issued. A rotated key is refused by register (403) and
      // stays dead — this never resurrects one.
      await register();
      res = await fetchWithTimeout(
        '/sync/otp',
        { method: 'POST', headers: { 'X-Sync-Key': key } },
        PUSH_TIMEOUT_MS,
      );
    }
    if (!res.ok) {
      const ra = Number(res.headers.get('Retry-After') ?? '60');
      if (res.status === 429) {
        await sleep(ra * 1000);
        throw new SyncClientError('OTP rate-limited', 429, ra);
      }
      throw new SyncClientError(`OTP failed: ${res.status}`, res.status);
    }
    return (await res.json()) as { code: string; expiresAt: number };
  }, (err) => err instanceof SyncClientError && err.status === 429);
}

export async function redeemCode(code: string): Promise<string> {
  return withRetry(async () => {
    const res = await fetchWithTimeout(
      '/sync/redeem',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) },
      PUSH_TIMEOUT_MS,
    );
    if (res.status === 404) throw new SyncClientError('Code not found', 404);
    if (res.status === 429) {
      const ra = Number(res.headers.get('Retry-After') ?? '60');
      await sleep(ra * 1000);
      throw new SyncClientError('Redeem rate-limited', 429, ra);
    }
    if (!res.ok) throw new SyncClientError(`Redeem failed: ${res.status}`, res.status);
    const body = (await res.json()) as { syncKey: string };
    if (!isValidSyncKey(body.syncKey)) {
      throw new SyncClientError('Invalid sync key in response', 500);
    }
    return body.syncKey;
  }, (err) => err instanceof SyncClientError && err.status === 429);
}

/** Mint an agent pairing code (master-key auth). The code is redeemed by
 *  `siftctl pair` or an OAS consumer; the token never passes through here. */
export async function mintAgentCode(): Promise<{ code: string; expiresAt: number }> {
  const key = await getStoredSyncKey();
  if (!key) throw new SyncClientError('No sync key stored', 401);
  return withRetry(async () => {
    const res = await fetchWithTimeout(
      '/sync/tokens',
      { method: 'POST', headers: { 'X-Sync-Key': key } },
      PUSH_TIMEOUT_MS,
    );
    if (res.status === 429) {
      const ra = Number(res.headers.get('Retry-After') ?? '60');
      await sleep(ra * 1000);
      throw new SyncClientError('Token mint rate-limited', 429, ra);
    }
    if (!res.ok) throw new SyncClientError(`Token mint failed: ${res.status}`, res.status);
    return (await res.json()) as { code: string; expiresAt: number };
  }, (err) => err instanceof SyncClientError && err.status === 429);
}

export interface AgentTokenInfo {
  token_id: string;
  fingerprint: string;
  scope: string;
  created_at: number;
  last_seen_at: number | null;
}

/** List agent tokens (master-key auth). Metadata only — never raw tokens. */
export async function listAgentTokens(): Promise<AgentTokenInfo[]> {
  const key = await getStoredSyncKey();
  if (!key) throw new SyncClientError('No sync key stored', 401);
  const res = await fetchWithTimeout(
    '/sync/tokens',
    { method: 'GET', headers: { 'X-Sync-Key': key } },
    PUSH_TIMEOUT_MS,
  );
  if (!res.ok) throw new SyncClientError(`Token list failed: ${res.status}`, res.status);
  const body = (await res.json()) as { tokens: AgentTokenInfo[] };
  return body.tokens;
}

/** Revoke an agent token by id (master-key auth). */
export async function revokeAgentToken(tokenId: string): Promise<void> {
  const key = await getStoredSyncKey();
  if (!key) throw new SyncClientError('No sync key stored', 401);
  const res = await fetchWithTimeout(
    '/sync/tokens',
    {
      method: 'DELETE',
      headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_id: tokenId }),
    },
    PUSH_TIMEOUT_MS,
  );
  if (!res.ok) throw new SyncClientError(`Token revoke failed: ${res.status}`, res.status);
}

export interface PushChunk {
  feeds?: unknown[];
  flags?: unknown[];
}

/**
 * Push a chunk. On 413, returns the payload as-is so the caller can split
 * and retry. A 401 is final — a rotated or revoked key is never
 * auto-registered (registration is explicit: pairing and rotation).
 */
export async function pushChunk(chunk: PushChunk): Promise<{ retried: boolean }> {
  const key = await getStoredSyncKey();
  if (!key) throw new SyncClientError('No sync key stored', 401);

  const res = await fetchWithTimeout(
    '/sync/push',
    {
      method: 'POST',
      headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    },
    PUSH_TIMEOUT_MS,
  );
  if (res.status === 413) {
    throw new SyncClientError('Payload too large', 413);
  }
  if (res.status === 429) {
    const ra = Number(res.headers.get('Retry-After') ?? '60');
    throw new SyncClientError('Push rate-limited', 429, ra);
  }
  if (res.status >= 500 || !res.ok) {
    throw new SyncClientError(`Push failed: ${res.status}`, res.status);
  }
  return { retried: false };
}

export async function pullSince(since: number): Promise<PullPayload> {
  const key = await getStoredSyncKey();
  if (!key) throw new SyncClientError('No sync key stored', 401);

  return withRetry(async () => {
    const res = await fetchWithTimeout(
      `/sync/pull?since=${encodeURIComponent(String(since))}`,
      { method: 'GET', headers: { 'X-Sync-Key': key } },
      PULL_TIMEOUT_MS,
    );
    if (res.status === 429) {
      const ra = Number(res.headers.get('Retry-After') ?? '60');
      await sleep(ra * 1000);
      throw new SyncClientError('Pull rate-limited', 429, ra);
    }
    if (!res.ok) throw new SyncClientError(`Pull failed: ${res.status}`, res.status);
    return (await res.json()) as PullPayload;
  }, (err) => err instanceof SyncClientError && err.status === 429);
}

/**
 * Helper for the receiving end of a pairing: store a sync key.
 */
export async function storeSyncKey(key: string): Promise<void> {
  if (!isValidSyncKey(key)) throw new SyncClientError('Invalid sync key', 400);
  await setStoredSyncKey(key);
}
