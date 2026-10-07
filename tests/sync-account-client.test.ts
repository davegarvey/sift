import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/open';
import { setStoredSyncKey } from '../src/sync/key';
import {
  KEY_REJECTED_MESSAGE,
  SyncClientError,
  deleteSyncAccount,
  pullSince,
  pushChunk,
} from '../src/sync/client';
import { resetSyncCapabilityCache } from '../src/sync/capabilities';
import { clearAllDirty, enqueueFlag, loadDirty } from '../src/sync/queue';
import { pullIfStale, pullNow } from '../src/sync/init';
import { flushNow, scheduleFlush } from '../src/sync/push';
import {
  keyRejected,
  lastError,
  lastErrorKind,
  loadStatus,
  resetSyncStatus,
} from '../src/sync/status';

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';

type Handler = (url: string, init: RequestInit | undefined) => Response;

function stubFetch(handler: Handler) {
  const calls: Array<{ url: string; method: string; key: string | null }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? 'GET', key: headers.get('X-Sync-Key') });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const capabilities = () => new Response(JSON.stringify({ sync: true, stats: false, items: false }));

beforeEach(async () => {
  const db = await getDb();
  await db.clear('meta');
  await db.clear('feeds');
  await db.clear('items');
  await db.clear('itemFlags');
  resetSyncCapabilityCache();
  await setStoredSyncKey(KEY);
  await loadStatus();
  resetSyncStatus();
  clearAllDirty();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('deleteSyncAccount', () => {
  it('sends DELETE /sync/account with the stored sync key', async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    await deleteSyncAccount();
    expect(calls).toEqual([{ url: '/sync/account', method: 'DELETE', key: KEY }]);
  });

  it('treats 401 as already deleted', async () => {
    const calls = stubFetch(() => new Response('Unauthorized', { status: 401 }));
    await expect(deleteSyncAccount()).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('surfaces rate limits with Retry-After and does not retry', async () => {
    const calls = stubFetch(() => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }));
    const error = await deleteSyncAccount().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncClientError);
    expect((error as SyncClientError).status).toBe(429);
    expect((error as SyncClientError).retryAfter).toBe(120);
    expect(calls).toHaveLength(1);
  });

  it('surfaces server errors without retrying', async () => {
    const calls = stubFetch(() => new Response(null, { status: 500 }));
    await expect(deleteSyncAccount()).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(1);
  });

  it('fails without a stored key and sends nothing', async () => {
    const db = await getDb();
    await db.clear('meta');
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    await expect(deleteSyncAccount()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(0);
  });
});

describe('a sync key the server no longer knows', () => {
  it('fails a pull once with a clear message and does not retry', async () => {
    const calls = stubFetch(() => new Response('Unauthorized', { status: 401 }));
    const error = await pullSince(0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncClientError);
    expect((error as SyncClientError).status).toBe(401);
    expect((error as SyncClientError).message).toBe(KEY_REJECTED_MESSAGE);
    expect(calls).toHaveLength(1);
  });

  it('fails a push once with a clear message and does not retry', async () => {
    const calls = stubFetch(() => new Response('Unauthorized', { status: 401 }));
    await expect(pushChunk({ feeds: [] })).rejects.toMatchObject({ status: 401, message: KEY_REJECTED_MESSAGE });
    expect(calls).toHaveLength(1);
  });

  it('records the error, then stops automatic pulls and pushes until an explicit sync', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let authorised = false;
    const calls = stubFetch((url) => {
      if (url === '/sync/capabilities') return capabilities();
      if (!authorised) return new Response('Unauthorized', { status: 401 });
      return new Response(JSON.stringify({ serverTime: Date.now(), feeds: [], flags: [] }));
    });
    const syncCalls = () => calls.filter((c) => c.url !== '/sync/capabilities');

    await loadDirty();
    await expect(pullNow()).rejects.toMatchObject({ status: 401 });
    expect(syncCalls()).toHaveLength(1);
    expect(keyRejected()).toBe(true);
    expect(lastError()).toBe(KEY_REJECTED_MESSAGE);
    expect(lastErrorKind()).toBe('pull');

    await pullIfStale(0);
    enqueueFlag({ itemId: 'f::g', feedId: 'f', read: 1, readAt: 1, starred: null, starredAt: 0 });
    scheduleFlush();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(syncCalls()).toHaveLength(1);

    await expect(pullNow()).rejects.toMatchObject({ status: 401 });
    expect(syncCalls()).toHaveLength(2);

    authorised = true;
    await pullNow();
    expect(keyRejected()).toBe(false);
    expect(lastError()).toBeNull();
    await flushNow();
    await pullIfStale(0);
    expect(syncCalls().length).toBeGreaterThan(3);
  });
});
