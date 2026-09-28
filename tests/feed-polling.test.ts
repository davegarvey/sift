import { describe, it, expect, beforeAll } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import path from 'path';
import { chunkItemRows, hostLanes, MAX_INSERT_CHUNK_BYTES } from '../server/feed-poller';
import { MAX_POLLED_FEEDS_PER_ACCOUNT } from '../server/poll-registry';
import { applyPollMigration } from './poll-db';

let workerCode: string;

beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../server/sync/test-poll-worker.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    write: false,
  });
  workerCode = result.outputFiles[0].text;
}, 15_000);

const POLL_CRON = '*/10 * * * *';

interface Upstream {
  requests: string[];
  respond: (url: URL) => Response | Promise<Response>;
}

function makeSyncKey(label: string): string {
  return (label + 'xxxxxxxxxxxxxxxxxxxxxx').slice(0, 22).replace(/[^A-Za-z0-9_-]/g, 'x');
}

function rss(entries: Array<{ guid: string; title?: string; html?: string }>): string {
  const items = entries.map((e) => `
    <item>
      <guid>${e.guid}</guid>
      <title>${e.title ?? e.guid}</title>
      <link>http://93.184.216.34/${encodeURIComponent(e.guid)}</link>
      <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      <description>Summary of ${e.guid}</description>
      ${e.html ? `<content:encoded><![CDATA[${e.html}]]></content:encoded>` : ''}
    </item>`).join('');
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Feed</title>${items}</channel></rss>`;
}

async function createMf(upstream: Upstream, bindings: Record<string, string> = { FEED_POLLING: 'true' }): Promise<Miniflare> {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: workerCode,
    d1Databases: ['DB', 'POLL_DB'],
    bindings,
    outboundService: (request: Request) => {
      const url = new URL(request.url);
      upstream.requests.push(url.toString());
      return upstream.respond(url);
    },
  }));
  await mf.ready;
  await applyPollMigration(mf, { maintainedAt: Date.now() });
  return mf;
}

async function register(mf: Miniflare, key: string): Promise<void> {
  const res = await mf.dispatchFetch('http://localhost/sync/register', { method: 'POST', headers: { 'X-Sync-Key': key } });
  expect(res.status).toBe(204);
}

async function push(mf: Miniflare, key: string, feeds: unknown[]): Promise<void> {
  const res = await mf.dispatchFetch('http://localhost/sync/push', {
    method: 'POST',
    headers: { 'X-Sync-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ feeds }),
  });
  expect(res.status).toBe(204);
}

async function subscribe(mf: Miniflare, key: string, feedId: string, feedUrl: string): Promise<void> {
  await push(mf, key, [{ feedId, feedUrl, title: 'Feed', deleted: 0 }]);
}

async function pull(mf: Miniflare, key: string): Promise<void> {
  const res = await mf.dispatchFetch('http://localhost/sync/pull?since=0', { headers: { 'X-Sync-Key': key } });
  expect(res.status).toBe(200);
}

interface ItemsPage {
  items: Array<{ seq: number; feed_id: string; guid: string; html: string | null; published_at: number | null }>;
  cursor: number;
  more: boolean;
}

async function items(mf: Miniflare, key: string, after = 0): Promise<ItemsPage> {
  const res = await mf.dispatchFetch(`http://localhost/sync/items?after=${after}`, { headers: { 'X-Sync-Key': key } });
  expect(res.status).toBe(200);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  return (await res.json()) as ItemsPage;
}

async function runCron(mf: Miniflare, cron = POLL_CRON): Promise<void> {
  const worker = await mf.getWorker();
  await worker.scheduled({ cron, scheduledTime: new Date() });
}

async function pollDb(mf: Miniflare) {
  return mf.getD1Database('POLL_DB');
}

async function registeredUrls(mf: Miniflare): Promise<string[]> {
  const rows = await (await pollDb(mf)).prepare('SELECT feed_url FROM polled_feeds ORDER BY feed_url').all<{ feed_url: string }>();
  return rows.results.map((row) => row.feed_url);
}

async function forceMaintenance(mf: Miniflare): Promise<void> {
  await (await pollDb(mf)).prepare("DELETE FROM poll_meta WHERE key = 'maintained_at'").run();
  await runCron(mf);
}

function feedRequests(upstream: Upstream, feedPath: string): number {
  return upstream.requests.filter((url) => url.endsWith(feedPath)).length;
}

describe('server feed polling', () => {
  it('is disabled without FEED_POLLING', async () => {
    const upstream: Upstream = { requests: [], respond: () => new Response(rss([{ guid: 'a' }])) };
    const mf = await createMf(upstream, {});
    try {
      const caps = (await (await mf.dispatchFetch('http://localhost/sync/capabilities')).json()) as { items: boolean };
      expect(caps.items).toBe(false);
      const key = makeSyncKey('disabled');
      await register(mf, key);
      await subscribe(mf, key, 'f1', 'http://93.184.216.34/off.xml');
      await pull(mf, key);
      await runCron(mf);
      expect(upstream.requests).toEqual([]);
      expect(await registeredUrls(mf)).toEqual([]);
      const res = await mf.dispatchFetch('http://localhost/sync/items', { headers: { 'X-Sync-Key': key } });
      expect(res.status).toBe(404);
    } finally {
      await mf.dispose();
    }
  });

  it('fetches a shared URL once and serves items under each account feed id', async () => {
    const upstream: Upstream = {
      requests: [],
      respond: () => new Response(rss([{ guid: 'one' }, { guid: 'two' }]), { headers: { ETag: '"v1"' } }),
    };
    const mf = await createMf(upstream);
    try {
      const caps = (await (await mf.dispatchFetch('http://localhost/sync/capabilities')).json()) as { items: boolean };
      expect(caps.items).toBe(true);
      const alice = makeSyncKey('alice');
      const bob = makeSyncKey('bob');
      for (const [key, feedId] of [[alice, 'alice-feed'], [bob, 'bob-feed']] as const) {
        await register(mf, key);
        await subscribe(mf, key, feedId, 'http://93.184.216.34/shared.xml');
        await pull(mf, key);
      }
      expect(await registeredUrls(mf)).toEqual(['http://93.184.216.34/shared.xml']);

      await runCron(mf);
      expect(feedRequests(upstream, '/shared.xml')).toBe(1);

      const alicePage = await items(mf, alice);
      expect(alicePage.more).toBe(false);
      expect(alicePage.items.map((i) => [i.feed_id, i.guid])).toEqual([['alice-feed', 'one'], ['alice-feed', 'two']]);
      expect(alicePage.items[0].published_at).toBe(Date.parse('2024-01-01T00:00:00Z'));
      expect(alicePage.items[0]).not.toHaveProperty('feed_url');
      const bobPage = await items(mf, bob);
      expect(bobPage.items.map((i) => i.feed_id)).toEqual(['bob-feed', 'bob-feed']);

      const next = await items(mf, alice, alicePage.cursor);
      expect(next.items).toEqual([]);
      expect(next.cursor).toBe(alicePage.cursor);

      await runCron(mf);
      expect(feedRequests(upstream, '/shared.xml')).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('does not duplicate stored entries on a later poll', async () => {
    const upstream: Upstream = { requests: [], respond: () => new Response(rss([{ guid: 'one' }])) };
    const mf = await createMf(upstream);
    try {
      const key = makeSyncKey('dedupe');
      await register(mf, key);
      await subscribe(mf, key, 'f', 'http://93.184.216.34/dedupe.xml');
      await pull(mf, key);
      await runCron(mf);
      const first = await items(mf, key);
      expect(first.items.map((i) => i.guid)).toEqual(['one']);

      await (await pollDb(mf)).prepare('UPDATE polled_feeds SET next_poll_at = 0').run();
      await runCron(mf);
      expect((await items(mf, key, first.cursor)).items).toEqual([]);
      const count = await (await pollDb(mf)).prepare('SELECT COUNT(*) AS n FROM polled_items').first<{ n: number }>();
      expect(count?.n).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('leases due feeds before fetching so an interrupted run does not block the queue', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const upstream: Upstream = {
      requests: [],
      respond: async () => {
        await gate;
        return new Response(rss([{ guid: 'a' }]));
      },
    };
    const mf = await createMf(upstream);
    try {
      const key = makeSyncKey('lease');
      await register(mf, key);
      await subscribe(mf, key, 'f', 'http://93.184.216.34/lease.xml');
      await pull(mf, key);
      const startedAt = Date.now();
      const run = runCron(mf);
      const db = await pollDb(mf);
      let lease: { next_poll_at: number; last_status: number | null } | null = null;
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        lease = await db.prepare('SELECT next_poll_at, last_status FROM polled_feeds')
          .first<{ next_poll_at: number; last_status: number | null }>();
        if (lease && lease.next_poll_at > startedAt) break;
      }
      expect(feedRequests(upstream, '/lease.xml')).toBe(1);
      expect(lease?.last_status).toBeNull();
      expect(lease!.next_poll_at).toBeGreaterThanOrEqual(startedAt + 30 * 60_000);
      release();
      await run;
      expect((await items(mf, key)).items).toHaveLength(1);
    } finally {
      release();
      await mf.dispose();
    }
  });

  it('backs off after an upstream rate limit and honours Retry-After', async () => {
    const upstream: Upstream = {
      requests: [],
      respond: () => new Response('slow down', { status: 429, headers: { 'Retry-After': '7200' } }),
    };
    const mf = await createMf(upstream);
    try {
      const key = makeSyncKey('limited');
      await register(mf, key);
      await subscribe(mf, key, 'f', 'http://93.184.216.34/limited.xml');
      await pull(mf, key);
      const startedAt = Date.now();
      await runCron(mf);
      const row = await (await pollDb(mf)).prepare('SELECT next_poll_at, failures, last_status FROM polled_feeds')
        .first<{ next_poll_at: number; failures: number; last_status: number }>();
      expect(row?.failures).toBe(1);
      expect(row?.last_status).toBe(429);
      expect(row!.next_poll_at).toBeGreaterThanOrEqual(startedAt + 7_200_000 - 5_000);
      expect((await items(mf, key)).items).toEqual([]);
    } finally {
      await mf.dispose();
    }
  });

  it('defers without counting a failure when a cooldown is already recorded', async () => {
    const upstream: Upstream = { requests: [], respond: () => new Response(rss([{ guid: 'a' }])) };
    const mf = await createMf(upstream);
    try {
      const url = 'http://93.184.216.34/cooling.xml';
      const key = makeSyncKey('cooling');
      await register(mf, key);
      await subscribe(mf, key, 'f', url);
      await pull(mf, key);
      const retryAt = Date.now() + 3_600_000;
      const syncDb = await mf.getD1Database('DB');
      await syncDb.prepare(`CREATE TABLE IF NOT EXISTS feed_fetch_failures (
        feed_key TEXT PRIMARY KEY, status INTEGER NOT NULL, retry_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`).run();
      await syncDb.prepare('INSERT INTO feed_fetch_failures (feed_key, status, retry_at, updated_at) VALUES (?, 429, ?, ?)')
        .bind(createHash('sha256').update(url).digest('hex'), retryAt, Date.now()).run();

      await runCron(mf);
      expect(feedRequests(upstream, '/cooling.xml')).toBe(0);
      const row = await (await pollDb(mf)).prepare('SELECT next_poll_at, failures, last_status FROM polled_feeds')
        .first<{ next_poll_at: number; failures: number; last_status: number }>();
      expect(row?.failures).toBe(0);
      expect(row?.last_status).toBe(429);
      expect(row!.next_poll_at).toBeGreaterThanOrEqual(retryAt - 5_000);
    } finally {
      await mf.dispose();
    }
  });

  it('polls every due feed on a shared host in one run', async () => {
    const upstream: Upstream = { requests: [], respond: (url) => new Response(rss([{ guid: url.pathname }])) };
    const mf = await createMf(upstream);
    try {
      const key = makeSyncKey('onehost');
      await register(mf, key);
      await push(mf, key, Array.from({ length: 8 }, (_, i) => ({
        feedId: `f${i}`, feedUrl: `http://93.184.216.34/channel-${i}.xml`, title: 'Feed', deleted: 0,
      })));
      await pull(mf, key);
      await runCron(mf);
      const rows = await (await pollDb(mf)).prepare('SELECT last_status, failures FROM polled_feeds')
        .all<{ last_status: number; failures: number }>();
      expect(rows.results).toHaveLength(8);
      expect(rows.results.every((row) => row.last_status === 200 && row.failures === 0)).toBe(true);
      expect((await items(mf, key)).items).toHaveLength(8);
    } finally {
      await mf.dispose();
    }
  }, 30_000);

  it('drops feed HTML above 64 KiB and paginates in pages of 200', async () => {
    const big = 'x'.repeat(70 * 1024);
    const upstream: Upstream = {
      requests: [],
      respond: (url) => {
        const n = Number(url.pathname.match(/p(\d)/)?.[1] ?? 0);
        return new Response(rss(Array.from({ length: 100 }, (_, i) => ({
          guid: `${n}-${i}`,
          html: n === 0 && i === 0 ? `<p>${big}</p>` : '<p>small</p>',
        }))));
      },
    };
    const mf = await createMf(upstream);
    try {
      const key = makeSyncKey('pages');
      await register(mf, key);
      for (const n of [0, 1, 2]) await subscribe(mf, key, `f${n}`, `http://93.184.216.34/p${n}.xml`);
      await pull(mf, key);
      await runCron(mf);

      const first = await items(mf, key);
      expect(first.items).toHaveLength(200);
      expect(first.more).toBe(true);
      const second = await items(mf, key, first.cursor);
      expect(second.items).toHaveLength(100);
      expect(second.more).toBe(false);

      const all = [...first.items, ...second.items];
      expect(new Set(all.map((i) => i.seq)).size).toBe(300);
      expect(all.find((i) => i.guid === '0-0')?.html).toBeNull();
      expect(all.find((i) => i.guid === '0-1')?.html).toBe('<p>small</p>');
    } finally {
      await mf.dispose();
    }
  }, 30_000);

  it('advances the cursor past items for feeds the caller does not follow', async () => {
    const upstream: Upstream = { requests: [], respond: () => new Response(rss([{ guid: 'a' }])) };
    const mf = await createMf(upstream);
    try {
      const reader = makeSyncKey('reader');
      const other = makeSyncKey('other');
      await register(mf, reader);
      await register(mf, other);
      await subscribe(mf, reader, 'mine', 'http://93.184.216.34/mine.xml');
      await subscribe(mf, other, 'f', 'http://93.184.216.34/other.xml');
      await (await pollDb(mf)).prepare("DELETE FROM polled_feeds WHERE feed_url LIKE '%mine.xml'").run();
      await pull(mf, reader);
      await pull(mf, other);
      await runCron(mf);
      const page = await items(mf, reader);
      expect(page.items).toEqual([]);
      expect(page.cursor).toBeGreaterThan(0);

      const res = await mf.dispatchFetch('http://localhost/sync/items?after=-1', { headers: { 'X-Sync-Key': reader } });
      expect(res.status).toBe(400);
      const anonymous = await mf.dispatchFetch('http://localhost/sync/items');
      expect(anonymous.status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('skips a run when the poll database is over its size limit', async () => {
    const upstream: Upstream = { requests: [], respond: () => new Response(rss([{ guid: 'a' }])) };
    const mf = await createMf(upstream, { FEED_POLLING: 'true', POLL_DB_MAX_BYTES: '1' });
    try {
      const key = makeSyncKey('full');
      await register(mf, key);
      await subscribe(mf, key, 'f', 'http://93.184.216.34/full.xml');
      await pull(mf, key);
      await runCron(mf);
      expect(upstream.requests).toEqual([]);
    } finally {
      await mf.dispose();
    }
  });
});

describe('poll maintenance', () => {
  it('rebuilds the registry from active subscriptions and expires old items', async () => {
    const upstream: Upstream = { requests: [], respond: () => new Response(rss([{ guid: 'a' }])) };
    const mf = await createMf(upstream);
    try {
      const active = makeSyncKey('active');
      const idle = makeSyncKey('idle');
      const never = makeSyncKey('never');
      for (const key of [active, idle, never]) await register(mf, key);
      await subscribe(mf, active, 'keep', 'http://93.184.216.34/keep.xml');
      await subscribe(mf, active, 'drop', 'http://93.184.216.34/drop.xml');
      await subscribe(mf, idle, 'idle', 'http://93.184.216.34/idle.xml');
      await subscribe(mf, never, 'never', 'http://93.184.216.34/never.xml');
      await pull(mf, active);
      await pull(mf, idle);
      const syncDb = await mf.getD1Database('DB');
      await syncDb.prepare('UPDATE users SET last_active_at = ? WHERE sync_key = ?')
        .bind(Math.floor(Date.now() / 1000) - 20 * 24 * 60 * 60, idle).run();
      await push(mf, active, [{ feedId: 'drop', deleted: 1 }]);
      await (await pollDb(mf)).prepare("DELETE FROM polled_feeds WHERE feed_url LIKE '%keep.xml'").run();
      await (await pollDb(mf)).prepare(
        "INSERT INTO polled_items (feed_url, guid, title, excerpt, first_seen_at) VALUES ('http://93.184.216.34/keep.xml', 'old', 't', 'e', 0)",
      ).run();

      await forceMaintenance(mf);
      expect(upstream.requests).toEqual([]);
      expect(await registeredUrls(mf)).toEqual(['http://93.184.216.34/keep.xml']);
      const remaining = await (await pollDb(mf)).prepare('SELECT COUNT(*) AS n FROM polled_items').first<{ n: number }>();
      expect(remaining?.n).toBe(0);

      await runCron(mf);
      expect(feedRequests(upstream, '/keep.xml')).toBe(1);
    } finally {
      await mf.dispose();
    }
  });

  it('polls at most the per-account cap of feeds', async () => {
    const upstream: Upstream = { requests: [], respond: () => new Response(rss([{ guid: 'a' }])) };
    const mf = await createMf(upstream);
    try {
      const key = makeSyncKey('hoarder');
      await register(mf, key);
      const total = MAX_POLLED_FEEDS_PER_ACCOUNT + 20;
      const feeds = Array.from({ length: total }, (_, i) => ({
        feedId: `f${String(i).padStart(4, '0')}`, feedUrl: `http://93.184.216.34/h${i}.xml`, title: 'Feed', deleted: 0,
      }));
      await push(mf, key, feeds);
      expect(await registeredUrls(mf)).toEqual([]);
      await pull(mf, key);
      await forceMaintenance(mf);
      const urls = await registeredUrls(mf);
      expect(urls).toHaveLength(MAX_POLLED_FEEDS_PER_ACCOUNT);
      expect(new Set(urls)).toEqual(new Set(feeds.slice(0, MAX_POLLED_FEEDS_PER_ACCOUNT).map((f) => f.feedUrl)));
    } finally {
      await mf.dispose();
    }
  });
});

describe('hostLanes', () => {
  it('groups feeds by host, preserving order within a host', () => {
    const lanes = hostLanes([
      { feed_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=a' },
      { feed_url: 'https://example.com/feed' },
      { feed_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=b' },
      { feed_url: 'not a url' },
    ]);
    expect(lanes.map((lane) => lane.map((feed) => feed.feed_url))).toEqual([
      ['https://www.youtube.com/feeds/videos.xml?channel_id=a', 'https://www.youtube.com/feeds/videos.xml?channel_id=b'],
      ['https://example.com/feed'],
      ['not a url'],
    ]);
  });
});

describe('chunkItemRows', () => {
  it('packs items into JSON arrays that stay under the chunk size', () => {
    const html = '<p>' + 'x'.repeat(60 * 1024) + '</p>';
    const items = Array.from({ length: 40 }, (_, i) => ({
      guid: `g${i}`, title: `T${i}`, publishedAt: null, excerpt: '', html, thumbnail: null,
    }));
    const chunks = chunkItemRows(items);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(new TextEncoder().encode(chunk).byteLength).toBeLessThanOrEqual(MAX_INSERT_CHUNK_BYTES + 2);
    const rows = chunks.flatMap((chunk) => JSON.parse(chunk) as Array<{ guid: string }>);
    expect(rows.map((row) => row.guid)).toEqual(items.map((item) => item.guid));
  });

  it('keeps a small feed in one statement', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ guid: `g${i}`, title: 'T', publishedAt: 1, excerpt: 'e' }));
    expect(chunkItemRows(items)).toHaveLength(1);
  });
});
