/**
 * Dev-mode D1 shim smoke tests.
 *
 * The local-d1 shim (server/sync/local-d1.ts) powers `npm run dev` sync
 * through the Vite proxy. Its SQL subset is narrower than real D1, so the
 * tombstone statements added by fix-feed-deletion-sync must be parseable by
 * it — otherwise dev mode silently diverges from production. These tests run
 * the real route handler against the shim and assert the same outcomes as
 * the D1 integration tests (tests/sync-d1.test.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSyncRoutes } from '../server/sync/routes';
import { LocalD1Database } from '../server/sync/local-d1';

function makeSyncKey(label: string): string {
  const raw = label + 'xxxxxxxxxxxxxxxxxxxx';
  return raw.slice(0, 22).replace(/[^A-Za-z0-9_-]/g, 'x');
}

describe('sync routes on the local-d1 shim', () => {
  let db: LocalD1Database;
  let app: ReturnType<typeof createSyncRoutes>;

  beforeEach(async () => {
    db = new LocalD1Database();
    app = createSyncRoutes(db as unknown as Parameters<typeof createSyncRoutes>[0]);
  });

  async function register(key: string): Promise<void> {
    const res = await app.request('/sync/register', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    expect(res.status).toBe(204);
  }

  async function push(key: string, body: unknown): Promise<number> {
    const res = await app.request('/sync/push', {
      method: 'POST',
      headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.status;
  }

  async function pullFeeds(key: string): Promise<Array<Record<string, unknown>>> {
    const res = await app.request('/sync/pull?since=0', {
      headers: { 'X-Sync-Key': key },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { feeds: Array<Record<string, unknown>> };
    return body.feeds;
  }

  async function pushStats(key: string, body: unknown): Promise<Response> {
    return app.request('/sync/stats/push', {
      method: 'POST',
      headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function feed(feedId: string, url: string): Record<string, unknown> {
    return {
      feedId,
      feedUrl: url,
      title: `Feed ${feedId.slice(0, 6)}`,
      deleted: 0,
    };
  }

  it('shim: a metadata-only push does not clear a tombstone', async () => {
    const key = makeSyncKey('shim-meta-');
    await register(key);
    const id = 'https://ex.com/meta';
    await push(key, { feeds: [feed(id, id)] });
    await push(key, { feeds: [{ feedId: id, deleted: 1 }] });
    await push(key, { feeds: [{ feedId: id, feedUrl: id, title: 'Renamed' }] });
    const feeds = await pullFeeds(key);
    const row = feeds.find((f) => f.feed_id === id);
    expect(row?.deleted).toBe(1);
    expect(row?.title).toBe('Renamed');
  });

  it('shim: a delete tombstones every row sharing the URL', async () => {
    const key = makeSyncKey('shim-del-1-');
    await register(key);
    const url = 'https://ex.com/shared';
    const a = 'shim-a';
    const b = 'shim-b';
    await push(key, { feeds: [feed(a, url), feed(b, url)] });
    await push(key, { feeds: [{ feedId: a, feedUrl: url, deleted: 1 }] });
    const feeds = await pullFeeds(key);
    expect(feeds.find((f) => f.feed_id === a)?.deleted).toBe(1);
    expect(feeds.find((f) => f.feed_id === b)?.deleted).toBe(1);
  });

  it('shim: a subscribe revives the tombstoned row by URL without inserting', async () => {
    const key = makeSyncKey('shim-revive');
    await register(key);
    const url = 'https://ex.com/revive';
    const original = 'shim-orig';
    const fresh = 'shim-fresh';
    await push(key, { feeds: [feed(original, url)] });
    await push(key, { feeds: [{ feedId: original, deleted: 1 }] });
    await push(key, { feeds: [feed(fresh, url)] });
    const feeds = await pullFeeds(key);
    const rows = feeds.filter((f) => f.feed_url === url);
    expect(rows.length).toBe(1);
    expect(rows[0].feed_id).toBe(original);
    expect(rows[0].deleted).toBe(0);
  });

  it('shim: a same-batch delete-then-subscribe revives the in-batch tombstone', async () => {
    const key = makeSyncKey('shim-batch-');
    await register(key);
    const url = 'https://ex.com/batch';
    const original = 'shim-borig';
    const fresh = 'shim-bfresh';
    await push(key, { feeds: [feed(original, url)] });
    await push(key, {
      feeds: [
        { feedId: original, feedUrl: url, deleted: 1 },
        feed(fresh, url),
      ],
    });
    const feeds = await pullFeeds(key);
    const rows = feeds.filter((f) => f.feed_url === url);
    expect(rows.length).toBe(1);
    expect(rows[0].feed_id).toBe(original);
    expect(rows[0].deleted).toBe(0);
  });

  it('shim: a same-batch subscribe-then-delete leaves no live row', async () => {
    const key = makeSyncKey('shim-batch2');
    await register(key);
    const url = 'https://ex.com/batch2';
    await push(key, {
      feeds: [
        { feedId: 'shim-new', feedUrl: url, deleted: 0 },
        { feedId: 'shim-new', feedUrl: url, deleted: 1 },
      ],
    });
    const feeds = await pullFeeds(key);
    expect(feeds.filter((f) => f.feed_url === url && f.deleted === 0).length).toBe(0);
  });

  it('shim: device OTP code redeems (pairing_codes.kind default)', async () => {
    const key = makeSyncKey('shim-otp---');
    await register(key);
    const otpRes = await app.request('/sync/otp', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    expect(otpRes.status).toBe(200);
    const { code } = (await otpRes.json()) as { code: string };

    const redeemRes = await app.request('/sync/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(redeemRes.status).toBe(200);
    const body = (await redeemRes.json()) as { syncKey: string };
    expect(body.syncKey).toBe(key);
  });

  it('shim: reading statistics deduplicate markers and merge volume by max', async () => {
    const key = makeSyncKey('shim-stats-');
    await register(key);
    const feedId = 'shim-stats-feed';
    const itemId = `${encodeURIComponent(feedId)}::article-1`;
    const first = await pushStats(key, {
      stats: [{ feedId, totalSeen: 10 }],
      markers: [{ itemId, feedId }],
    });
    expect(first.status).toBe(200);
    const second = await pushStats(key, {
      stats: [{ feedId, totalSeen: 5 }],
      markers: [{ itemId, feedId }],
    });
    expect(second.status).toBe(200);
    const body = await second.json() as { stats: Array<Record<string, unknown>> };
    expect(body.stats[0].total_seen).toBe(10);
    expect(body.stats[0].read_once).toBe(1);
  });

  it('shim: feed tombstone cleanup retains aggregate statistics', async () => {
    const key = makeSyncKey('shim-retain-');
    await register(key);
    const feedId = 'shim-retained-feed';
    await push(key, { feeds: [feed(feedId, 'https://ex.com/retained')] });
    await pushStats(key, { stats: [{ feedId, totalSeen: 12 }] });
    await push(key, { feeds: [{ feedId, feedUrl: 'https://ex.com/retained', deleted: 1 }] });
    const { runSyncCron } = await import('../server/sync/cron');
    await runSyncCron(db as unknown as Parameters<typeof createSyncRoutes>[0], Date.now() + 31 * 24 * 60 * 60 * 1000);
    const statsRes = await app.request('/sync/stats/pull?since=0', { headers: { 'X-Sync-Key': key } });
    expect(statsRes.status).toBe(200);
    const body = await statsRes.json() as { stats: Array<Record<string, unknown>> };
    expect(body.stats.find((row) => row.feed_id === feedId)?.total_seen).toBe(12);
  });
});

describe('local-d1 persistence', () => {
  it('round-trips tables through the persist file', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'sift-local-d1-'));
    const path = join(dir, 'db.json');

    try {
      const first = new LocalD1Database({ persistPath: path });
      const key = makeSyncKey('shim-persist');
      const app = createSyncRoutes(first as unknown as Parameters<typeof createSyncRoutes>[0]);
      const reg = await app.request('/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });
      expect(reg.status).toBe(204);
      await new Promise((r) => setTimeout(r, 150)); // let the debounced flush land

      const second = new LocalD1Database({ persistPath: path });
      const app2 = createSyncRoutes(second as unknown as Parameters<typeof createSyncRoutes>[0]);
      const pull = await app2.request('/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      expect(pull.status).toBe(200);
      expect((await pull.json() as { feeds: unknown[] }).feeds).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
