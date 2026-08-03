import { describe, it, expect, beforeAll } from 'vitest';
import { Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import path from 'path';

// Bundle the minimal sync-only worker — no frontend code, fast.
let workerCode: string;

beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../server/sync/test-worker.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
  });
  workerCode = result.outputFiles[0].text;
}, 15_000);

function makeSyncKey(label: string): string {
  const raw = label + 'xxxxxxxxxxxxxxxxxxxx';
  return raw.slice(0, 22).replace(/[^A-Za-z0-9_-]/g, 'x');
}

async function createMf(): Promise<Miniflare> {
  const mf = new Miniflare({
    modules: true,
    script: workerCode,
    d1Databases: ['DB'],
  });
  await mf.ready;
  return mf;
}

describe('sync D1 integration', () => {
  it('register creates a user and confirms idempotency', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('reg-test---');

      const r1 = await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });
      expect(r1.status).toBe(204);

      // Re-register with same key → idempotent
      const r2 = await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });
      expect(r2.status).toBe(204);
    } finally {
      await mf.dispose();
    }
  });

  it('register without header returns 401', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('register with invalid key returns 401', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': 'too-short' },
      });
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('push without auth returns 401', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds: [] }),
      });
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('pull without auth returns 401', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/pull?since=0');
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('push -> pull round-trips a feed', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('push-pull-');

      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const now = Date.now();
      const pushRes = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://example.com/blog',
            feedUrl: { value: 'https://example.com/blog', at: now },
            title: { value: 'Test Feed', at: now },
            deleted: { value: 0, at: now },
          }],
        }),
      });
      expect(pushRes.status).toBe(204);

      const pullRes = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      expect(pullRes.status).toBe(200);
      const pull = await pullRes.json() as { feeds: Array<Record<string, unknown>> };
      expect(pull.feeds).toBeDefined();
      expect(pull.feeds.length).toBe(1);
      expect(pull.feeds[0].feed_url).toBe('https://example.com/blog');
      expect(pull.feeds[0].title).toBe('Test Feed');
      // row_at should be > 0 (not the old value bug)
      expect((pull.feeds[0].row_at as number) > 0).toBe(true);
    } finally {
      await mf.dispose();
    }
  });

  it('push -> pull round-trips tags on a feed', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('tags-round-');

      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const now = Date.now();
      const pushRes = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://example.com/tagged',
            feedUrl: { value: 'https://example.com/tagged', at: now },
            title: { value: 'Tagged Feed', at: now },
            tags: { value: ['news', 'tech'], at: now },
            deleted: { value: 0, at: now },
          }],
        }),
      });
      expect(pushRes.status).toBe(204);

      const pullRes = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      expect(pullRes.status).toBe(200);
      const pull = await pullRes.json() as { feeds: Array<Record<string, unknown>> };
      expect(pull.feeds).toBeDefined();
      expect(pull.feeds.length).toBe(1);
      expect(pull.feeds[0].feed_url).toBe('https://example.com/tagged');
      // tags should be stored as JSON text and returned as-is
      expect(pull.feeds[0].tags).toBe(JSON.stringify(['news', 'tech']));
      expect(pull.feeds[0].tags_at).toBe(now);
    } finally {
      await mf.dispose();
    }
  });

  it('push -> pull round-trips a flag', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('flag-round--');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const now = Date.now();
      const feedId = 'https://example.com/news';
      const itemId = `${encodeURIComponent(feedId)}::article-1`;

      await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flags: [{
            itemId,
            feedId,
            read: { value: 1, at: now },
            starred: { value: 1, at: now },
          }],
        }),
      });

      const pullRes = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      expect(pullRes.status).toBe(200);
      const pull = await pullRes.json() as { flags: Array<Record<string, unknown>> };
      expect(pull.flags).toBeDefined();
      expect(pull.flags.length).toBe(1);
      expect(pull.flags[0].item_id).toBe(itemId);
      expect(pull.flags[0].read).toBe(1);
      expect(pull.flags[0].starred).toBe(1);
      expect((pull.flags[0].row_at as number) > 0).toBe(true);
    } finally {
      await mf.dispose();
    }
  });

  it('pull respects since parameter', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('since-test');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const t1 = Date.now();
      await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://example.com/old',
            feedUrl: { value: 'https://example.com/old', at: t1 },
            title: { value: 'Old Feed', at: t1 },
            deleted: { value: 0, at: t1 },
          }],
        }),
      });

      // Pull with since = now to exclude the first feed
      const sincePull = await mf.dispatchFetch(`http://localhost/sync/pull?since=${t1 + 1000}`, {
        headers: { 'X-Sync-Key': key },
      });
      expect(sincePull.status).toBe(200);
      const sinceData = await sincePull.json() as { feeds: Array<Record<string, unknown>> };
      expect(sinceData.feeds.length).toBe(0);

      // Pull with since = 0 should include it
      const fullPull = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': key },
      });
      const fullData = await fullPull.json() as { feeds: Array<Record<string, unknown>> };
      expect(fullData.feeds.length).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('multi-device: OTP + redeem syncs feeds across keys', async () => {
    const mf = await createMf();
    try {
      const keyA = makeSyncKey('device-A----');
      const now = Date.now();

      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': keyA },
      });

      await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': keyA, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feeds: [{
            feedId: 'https://example.com/rss',
            feedUrl: { value: 'https://example.com/rss', at: now },
            title: { value: 'Device A Feed', at: now },
            deleted: { value: 0, at: now },
          }],
        }),
      });

      const otpRes = await mf.dispatchFetch('http://localhost/sync/otp', {
        method: 'POST',
        headers: { 'X-Sync-Key': keyA },
      });
      expect(otpRes.status).toBe(200);
      const otp = await otpRes.json() as { code: string };
      expect(otp.code).toBeTruthy();
      expect(otp.code.length).toBe(8);

      const redeemRes = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otp.code }),
      });
      expect(redeemRes.status).toBe(200);
      const redeem = await redeemRes.json() as { syncKey: string };
      expect(redeem.syncKey).toBe(keyA);

      // Device B pulls using the redeemed key
      const pullRes = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
        headers: { 'X-Sync-Key': redeem.syncKey },
      });
      expect(pullRes.status).toBe(200);
      const pull = await pullRes.json() as { feeds: Array<Record<string, unknown>> };
      expect(pull.feeds.length).toBe(1);
      expect(pull.feeds[0]).toMatchObject({
        feed_url: 'https://example.com/rss',
        title: 'Device A Feed',
      });
    } finally {
      await mf.dispose();
    }
  });

  it('OTP returns 401 for unregistered key', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/otp', {
        method: 'POST',
        headers: { 'X-Sync-Key': makeSyncKey('no-such') },
      });
      expect(res.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('redeem of unknown code returns 404', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'deadbeef' }),
      });
      expect(res.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });

  it('redeem of invalid format returns 400', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ab' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await mf.dispose();
    }
  });

  it('redeem consumes code on first use (one-time)', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('one-time--');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const otpRes = await mf.dispatchFetch('http://localhost/sync/otp', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });
      const otp = await otpRes.json() as { code: string };

      // First redeem → success
      const r1 = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otp.code }),
      });
      expect(r1.status).toBe(200);

      // Second redeem with same code → 404 (deleted after use)
      const r2 = await mf.dispatchFetch('http://localhost/sync/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otp.code }),
      });
      expect(r2.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });

  it('caps capabilities endpoint', async () => {
    const mf = await createMf();
    try {
      const res = await mf.dispatchFetch('http://localhost/sync/capabilities');
      expect(res.status).toBe(200);
      const cap = await res.json() as { sync: boolean };
      expect(cap.sync).toBe(true);
    } finally {
      await mf.dispose();
    }
  });

  it('push with empty feeds/flags returns 204 no-op', async () => {
    const mf = await createMf();
    try {
      const key = makeSyncKey('empty-push');
      await mf.dispatchFetch('http://localhost/sync/register', {
        method: 'POST',
        headers: { 'X-Sync-Key': key },
      });

      const res = await mf.dispatchFetch('http://localhost/sync/push', {
        method: 'POST',
        headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ feeds: [], flags: [] }),
      });
      expect(res.status).toBe(204);
    } finally {
      await mf.dispose();
    }
  });
});

describe('sync D1 tombstone semantics', () => {
  async function setupKey(mf: Miniflare, label: string): Promise<string> {
    const key = makeSyncKey(label);
    await mf.dispatchFetch('http://localhost/sync/register', {
      method: 'POST',
      headers: { 'X-Sync-Key': key },
    });
    return key;
  }

  async function push(mf: Miniflare, key: string, body: unknown): Promise<number> {
    const res = await mf.dispatchFetch('http://localhost/sync/push', {
      method: 'POST',
      headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.status;
  }

  async function pullFeeds(mf: Miniflare, key: string): Promise<Array<Record<string, unknown>>> {
    const res = await mf.dispatchFetch('http://localhost/sync/pull?since=0', {
      headers: { 'X-Sync-Key': key },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { feeds: Array<Record<string, unknown>> };
    return body.feeds;
  }

  function feedPayload(feedId: string, url: string, at: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      feedId,
      feedUrl: { value: url, at },
      title: { value: `Feed ${feedId.slice(0, 6)}`, at },
      deleted: { value: 0, at },
      ...extra,
    };
  }

  it('a metadata-only push does not clear a tombstone', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'meta-noclear');
      const now = Date.now();
      const id = 'https://example.com/meta';
      await push(mf, key, { feeds: [feedPayload(id, id, now)] });
      await push(mf, key, {
        feeds: [{ feedId: id, deleted: { value: 1, at: now + 100 } }],
      });
      await push(mf, key, {
        feeds: [{ feedId: id, feedUrl: { value: id, at: now + 200 }, title: { value: 'Renamed', at: now + 200 } }],
      });
      const feeds = await pullFeeds(mf, key);
      const row = feeds.find((f) => f.feed_id === id);
      expect(row?.deleted).toBe(1);
      expect(row?.title).toBe('Renamed');
    } finally {
      await mf.dispose();
    }
  });

  it('a deleted:1 push does not regress a newer tombstone timestamp', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'no-regress-');
      const now = Date.now();
      const id = 'https://example.com/regress';
      await push(mf, key, { feeds: [feedPayload(id, id, now)] });
      await push(mf, key, {
        feeds: [{ feedId: id, deleted: { value: 1, at: now + 500 } }],
      });
      await push(mf, key, {
        feeds: [{ feedId: id, feedUrl: { value: id, at: now + 400 }, deleted: { value: 1, at: now + 400 } }],
      });
      const feeds = await pullFeeds(mf, key);
      const row = feeds.find((f) => f.feed_id === id);
      expect(row?.deleted).toBe(1);
      expect(row?.deleted_at).toBe(now + 500);
    } finally {
      await mf.dispose();
    }
  });

  it('a delete tombstones every row sharing the URL', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'delete-url');
      const now = Date.now();
      const url = 'https://example.com/shared';
      const a = 'device-a-feed';
      const b = 'device-b-feed';
      await push(mf, key, { feeds: [feedPayload(a, url, now), feedPayload(b, url, now)] });
      await push(mf, key, {
        feeds: [{ feedId: a, feedUrl: { value: url, at: now }, deleted: { value: 1, at: now + 100 } }],
      });
      const feeds = await pullFeeds(mf, key);
      const ra = feeds.find((f) => f.feed_id === a);
      const rb = feeds.find((f) => f.feed_id === b);
      expect(ra?.deleted).toBe(1);
      expect(rb?.deleted).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('a legacy URL-less delete resolves the URL from the stored row', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'legacy-del');
      const now = Date.now();
      const url = 'https://example.com/legacy';
      const a = 'legacy-a';
      const b = 'legacy-b';
      await push(mf, key, { feeds: [feedPayload(a, url, now), feedPayload(b, url, now)] });
      await push(mf, key, {
        feeds: [{ feedId: a, deleted: { value: 1, at: now + 100 } }],
      });
      const feeds = await pullFeeds(mf, key);
      expect(feeds.find((f) => f.feed_id === a)?.deleted).toBe(1);
      expect(feeds.find((f) => f.feed_id === b)?.deleted).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('a subscribe revives the oldest tombstoned row by URL instead of inserting', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'revive-url');
      const now = Date.now();
      const url = 'https://example.com/revive';
      const original = 'original-id';
      const fresh = 'fresh-uuid';
      await push(mf, key, { feeds: [feedPayload(original, url, now)] });
      await push(mf, key, {
        feeds: [{ feedId: original, deleted: { value: 1, at: now + 100 } }],
      });
      await push(mf, key, { feeds: [feedPayload(fresh, url, now + 200)] });
      const feeds = await pullFeeds(mf, key);
      const rows = feeds.filter((f) => f.feed_url === url);
      expect(rows.length).toBe(1);
      expect(rows[0].feed_id).toBe(original);
      expect(rows[0].deleted).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('a same-batch delete-then-subscribe revives the in-batch tombstone', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'batch-del-sub');
      const now = Date.now();
      const url = 'https://example.com/batch1';
      const original = 'batch-orig';
      const fresh = 'batch-fresh';
      await push(mf, key, { feeds: [feedPayload(original, url, now)] });
      await push(mf, key, {
        feeds: [
          { feedId: original, feedUrl: { value: url, at: now + 100 }, deleted: { value: 1, at: now + 100 } },
          feedPayload(fresh, url, now + 200),
        ],
      });
      const feeds = await pullFeeds(mf, key);
      const rows = feeds.filter((f) => f.feed_url === url);
      expect(rows.length).toBe(1);
      expect(rows[0].feed_id).toBe(original);
      expect(rows[0].deleted).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('a same-batch subscribe-then-delete leaves no live row', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'batch-sub-del');
      const now = Date.now();
      const url = 'https://example.com/batch2';
      const keeper = 'batch-keeper';
      await push(mf, key, { feeds: [feedPayload(keeper, url, now)] });
      await push(mf, key, {
        feeds: [
          feedPayload('batch-new', url, now + 100),
          { feedId: keeper, feedUrl: { value: url, at: now + 100 }, deleted: { value: 1, at: now + 200 } },
        ],
      });
      const feeds = await pullFeeds(mf, key);
      const live = feeds.filter((f) => f.feed_url === url && f.deleted === 0);
      expect(live.length).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('a delete of a server-unknown feed_id still tombstones URL siblings', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'ghost-del-');
      const now = Date.now();
      const url = 'https://example.com/ghost';
      const b = 'ghost-sibling';
      await push(mf, key, { feeds: [feedPayload(b, url, now)] });
      await push(mf, key, {
        feeds: [{ feedId: 'never-pushed', feedUrl: { value: url, at: now + 100 }, deleted: { value: 1, at: now + 100 } }],
      });
      const feeds = await pullFeeds(mf, key);
      const ghost = feeds.find((f) => f.feed_id === 'never-pushed');
      expect(ghost?.deleted).toBe(1);
      expect(feeds.find((f) => f.feed_id === b)?.deleted).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('a delete after a remote rename tombstones rows under the winning URL', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'rename-del');
      const now = Date.now();
      const oldUrl = 'https://example.com/old';
      const newUrl = 'https://example.com/new';
      const target = 'rename-target';
      const sibling = 'rename-sibling';
      await push(mf, key, { feeds: [feedPayload(target, oldUrl, now)] });
      await push(mf, key, { feeds: [feedPayload(sibling, newUrl, now + 50)] });
      await push(mf, key, {
        feeds: [{ feedId: target, feedUrl: { value: newUrl, at: now + 100 } }],
      });
      await push(mf, key, {
        feeds: [{ feedId: target, feedUrl: { value: oldUrl, at: now + 80 }, deleted: { value: 1, at: now + 80 } }],
      });
      const feeds = await pullFeeds(mf, key);
      const rt = feeds.find((f) => f.feed_id === target);
      expect(rt?.deleted).toBe(1);
      expect(rt?.feed_url).toBe(newUrl);
      const rs = feeds.find((f) => f.feed_id === sibling);
      expect(rs?.deleted).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('a subscribe during the tombstone window revives without creating a duplicate', async () => {
    const mf = await createMf();
    try {
      const key = await setupKey(mf, 'tomb-window');
      const now = Date.now();
      const url = 'https://example.com/window';
      const original = 'window-orig';
      await push(mf, key, { feeds: [feedPayload(original, url, now)] });
      await push(mf, key, {
        feeds: [{ feedId: original, deleted: { value: 1, at: now + 100 } }],
      });
      await push(mf, key, {
        feeds: [{ feedId: original, feedUrl: { value: url, at: now + 200 }, deleted: { value: 0, at: now + 200 } }],
      });
      const feeds = await pullFeeds(mf, key);
      const rows = feeds.filter((f) => f.feed_url === url);
      expect(rows.length).toBe(1);
      expect(rows[0].deleted).toBe(0);
    } finally {
      await mf.dispose();
    }
  });
});
