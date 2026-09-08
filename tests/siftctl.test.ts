import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCli } from '../packages/siftctl/src/cli';
import { capabilities, pullStats } from '../packages/siftctl/src/api';
import { tokenFingerprint } from '../packages/siftctl/src/fingerprint';
import { fetchFeedMetadata, fetchItems } from '../packages/siftctl/src/items';
import { buildStats, deriveFeedStats, sortStatsRows } from '../packages/siftctl/src/stats';
import { packageVersion } from '../packages/siftctl/src/version';

const BASE = 'https://sift.example';
let home: string;
let tokenFile: string;
let stdout: string;
let stderr: string;

function setTokenFile(token: string | null): void {
  if (token === null) {
    const { rmSync: rm } = { rmSync };
    rm(tokenFile, { force: true });
  } else {
    const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(path.dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, token);
  }
}

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'siftctl-test-'));
  tokenFile = path.join(home, 'siftctl', 'token');
  delete process.env.SIFTCTL_TOKEN;
  process.env.SIFTCTL_URL = BASE;
  process.env.SIFTCTL_HOME = home;
  stdout = '';
  stderr = '';
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout += args.join(' ') + '\n';
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr += args.join(' ') + '\n';
  });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', handler);
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TOKEN = 't' + 'A'.repeat(22);
const FEED_XML = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example Feed</title><link>https://x.com/</link>
  <item><title>One</title><link>https://x.com/1</link><guid>guid-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate><description>d</description></item>
</channel></rss>`;

describe('siftctl: pair', () => {
  it('redeems a code and writes the token file with 0600 permissions', async () => {
    mockFetch(async (url) => {
      expect(url).toBe(`${BASE}/sync/tokens/redeem`);
      return jsonRes({ token: TOKEN });
    });
    const code = await runCli(['pair', 'abc12345']);
    expect(code).toBe(0);
    expect(readFileSync(tokenFile, 'utf8').trim()).toBe(TOKEN);
    expect((statSync(tokenFile).mode & 0o777)).toBe(0o600);
    expect(stdout).toContain('Paired.');
  });

  it('does not write a token when redemption fails', async () => {
    mockFetch(async () => jsonRes({ error: 'x' }, 404));
    const code = await runCli(['pair', 'badcode1']);
    expect(code).toBe(1);
    expect(existsSync(tokenFile)).toBe(false);
  });

  it('usage error without a code', async () => {
    const code = await runCli(['pair']);
    expect(code).toBe(2);
    expect(stderr).toContain('pair requires a code');
  });
});

describe('siftctl: tokenFingerprint', () => {
  it('computes a fingerprint without relying on the global crypto object', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const fp = await tokenFingerprint(TOKEN);
      expect(fp).toHaveLength(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('matches the documented Crockford fingerprint scheme', async () => {
    expect(await tokenFingerprint('test-token')).toBe('RQE9');
  });
});

describe('siftctl: package version', () => {
  it('reads the version from package metadata', () => {
    const metadata = JSON.parse(readFileSync(new URL('../packages/siftctl/package.json', import.meta.url), 'utf8')) as { version: string };
    expect(packageVersion()).toBe(metadata.version);
  });

  it('prints the version without loading a token or contacting the server', async () => {
    let called = false;
    mockFetch(async () => {
      called = true;
      return jsonRes({}, 500);
    });
    await expect(runCli(['--version'])).resolves.toBe(0);
    expect(stdout.trim()).toBe(packageVersion());
    await expect(runCli(['-v'])).resolves.toBe(0);
    expect(stdout.trim().split('\n')).toEqual([packageVersion(), packageVersion()]);
    expect(called).toBe(false);
  });

  it('rejects unexpected version arguments', async () => {
    const code = await runCli(['--version', 'extra']);
    expect(code).toBe(2);
    expect(stderr).toContain('takes no arguments');
  });
});

describe('siftctl: feed metadata discovery', () => {
  it('reads the feed title and HTML URL', async () => {
    mockFetch(async (url) => {
      expect(url).toBe('https://x.com/feed.xml');
      return new Response(FEED_XML, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    });
    await expect(fetchFeedMetadata('https://x.com/feed.xml')).resolves.toEqual({
      title: 'Example Feed',
      htmlUrl: 'https://x.com/',
    });
  });
});

describe('siftctl: statistics derivation', () => {
  it('filters live feeds, fills missing rows, and derives browser-parity metrics', () => {
    const result = buildStats(
      [
        { feed_id: 'feed-a', feed_url: 'https://example.com/a', title: 'Alpha', deleted: 0 },
        { feed_id: 'feed-a-duplicate', feed_url: 'https://example.com/a', title: 'Duplicate', deleted: 0 },
        { feed_id: 'feed-b', feed_url: 'https://example.com/b', title: 'Beta', deleted: 0 },
        { feed_id: 'feed-c', feed_url: 'https://example.com/c', title: 'Deleted', deleted: 1 },
      ],
      [{ feed_id: 'feed-a', total_seen: 100, read_once: 20 }],
    );
    expect(result.summary).toEqual({ totalSeen: 100, readOnce: 20, readRate: 0.2 });
    expect(result.feeds).toHaveLength(2);
    expect(result.feeds[0]).toMatchObject({ feedId: 'feed-a', readRate: 0.2, expectedReads: 20, readIndex: 1, backlog: 80 });
    expect(result.feeds[1]).toMatchObject({ feedId: 'feed-b', totalSeen: 0, readOnce: 0, readRate: null, expectedReads: null, readIndex: null });
  });

  it('treats invalid counters as zero and clamps read-once counts', () => {
    const row = deriveFeedStats(
      { feed_id: 'feed-a', feed_url: 'https://example.com/a', title: 'Alpha' },
      { totalSeen: -1, readOnce: 4 },
      0.5,
    );
    expect(row).toMatchObject({ totalSeen: 0, readOnce: 0, readRate: null, expectedReads: null, readIndex: null, backlog: 0 });
    const result = buildStats(
      [{ feed_id: 'feed-a', feed_url: 'https://example.com/a', title: 'Alpha', deleted: 0 }],
      [{ feed_id: 'feed-a', total_seen: 5, read_once: 9 }],
    );
    expect(result.feeds[0].readOnce).toBe(5);
    expect(result.summary.readOnce).toBe(5);
  });

  it('orders equal read counts by title and then feed ID', () => {
    const rows = [
      deriveFeedStats({ feed_id: 'z', feed_url: 'https://example.com/z', title: 'Zulu' }, { totalSeen: 10, readOnce: 5 }, 0.5),
      deriveFeedStats({ feed_id: 'a', feed_url: 'https://example.com/a', title: 'Alpha' }, { totalSeen: 10, readOnce: 5 }, 0.5),
    ];
    expect(sortStatsRows(rows).map((row) => row.feedId)).toEqual(['a', 'z']);
  });
});

describe('siftctl: stats command', () => {
  it('returns a synchronized, approximate JSON snapshot for live feeds', async () => {
    setTokenFile(TOKEN);
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/capabilities`) return jsonRes({ sync: true, stats: true });
      if (url === `${BASE}/sync/pull?since=0`) {
        return jsonRes({
          serverTime: 1,
          feeds: [
            { feed_id: 'feed-a', feed_url: 'https://example.com/a', title: 'A', deleted: 0 },
            { feed_id: 'feed-a-duplicate', feed_url: 'https://example.com/a', title: 'A duplicate', deleted: 0 },
            { feed_id: 'feed-b', feed_url: 'https://example.com/b', title: 'B', deleted: 0 },
            { feed_id: 'feed-old', feed_url: 'https://example.com/old', title: 'Old', deleted: 1 },
          ],
          flags: [],
        });
      }
      if (url === `${BASE}/sync/stats/pull?since=0`) {
        return jsonRes({
          serverTime: 1,
          stats: [
            { feed_id: 'feed-a', total_seen: 100, read_once: 20 },
            { feed_id: 'feed-b', total_seen: 50, read_once: 15 },
            { feed_id: 'feed-old', total_seen: 500, read_once: 500 },
          ],
          markers: [],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const code = await runCli(['stats', '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      source: 'sync',
      approximate: true,
      summary: {
        totalSeen: 150,
        readOnce: 35,
        readRate: 35 / 150,
      },
      feeds: [
        {
          feedId: 'feed-a',
          title: 'A',
          url: 'https://example.com/a',
          totalSeen: 100,
          readOnce: 20,
          readRate: 0.2,
          expectedReads: 100 * (35 / 150),
          readIndex: 20 / (100 * (35 / 150)),
          backlog: 80,
        },
        {
          feedId: 'feed-b',
          title: 'B',
          url: 'https://example.com/b',
          totalSeen: 50,
          readOnce: 15,
          readRate: 0.3,
          expectedReads: 50 * (35 / 150),
          readIndex: 15 / (50 * (35 / 150)),
          backlog: 35,
        },
      ],
    });
    expect(stderr).toBe('');
  });

  it('prints synchronized human-readable output', async () => {
    setTokenFile(TOKEN);
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/capabilities`) return jsonRes({ sync: true, stats: true });
      if (url === `${BASE}/sync/pull?since=0`) return jsonRes({ serverTime: 1, feeds: [{ feed_id: 'feed-a', feed_url: 'https://example.com/a', title: 'A', deleted: 0 }], flags: [] });
      if (url === `${BASE}/sync/stats/pull?since=0`) return jsonRes({ serverTime: 1, stats: [{ feed_id: 'feed-a', total_seen: 10, read_once: 2 }], markers: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });
    const code = await runCli(['stats']);
    expect(code).toBe(0);
    expect(stdout).toContain('Synchronized reading statistics (approximate across devices)');
    expect(stdout).toContain('A\t10\t2\t20%');
  });

  it('fails clearly when statistics are not advertised', async () => {
    setTokenFile(TOKEN);
    let pullCalled = false;
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/capabilities`) return jsonRes({ sync: true, stats: false });
      pullCalled = true;
      return jsonRes({}, 500);
    });
    const code = await runCli(['stats']);
    expect(code).toBe(1);
    expect(pullCalled).toBe(false);
    expect(stderr).toContain('Statistics unavailable');
  });

  it('does not contact the server without a token', async () => {
    let called = false;
    mockFetch(async () => {
      called = true;
      return jsonRes({}, 500);
    });
    const code = await runCli(['stats']);
    expect(code).toBe(1);
    expect(called).toBe(false);
    expect(stderr).toContain('Not paired');
  });
});

describe('siftctl: status', () => {
  it('reports capabilities, URL, and token fingerprint', async () => {
    setTokenFile(TOKEN);
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/capabilities`) {
        return jsonRes({ sync: true });
      }
      if (url === `${BASE}/sync/status`) {
        return jsonRes({ groupFingerprint: 'XK7B' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const code = await runCli(['status', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.sync).toBe(true);
    expect(parsed.url).toBe(BASE);
    expect(parsed.paired).toBe(true);
    expect(parsed.fingerprint).toBe(await tokenFingerprint(TOKEN));
    expect(parsed.groupFingerprint).toBe('XK7B');
  });

  it('prints the group code in human-readable output', async () => {
    setTokenFile(TOKEN);
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/capabilities`) {
        return jsonRes({ sync: true });
      }
      if (url === `${BASE}/sync/status`) {
        return jsonRes({ groupFingerprint: 'XK7B' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const code = await runCli(['status']);
    expect(code).toBe(0);
    expect(stdout).toContain('Group: XK7B');
  });

  it('degrades gracefully when the server lacks /sync/status (404)', async () => {
    setTokenFile(TOKEN);
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/capabilities`) {
        return jsonRes({ sync: true });
      }
      if (url === `${BASE}/sync/status`) {
        return new Response('Not Found', { status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const code = await runCli(['status', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.paired).toBe(true);
    expect(parsed.groupFingerprint).toBeNull();
  });
});

describe('siftctl: statistics API', () => {
  it('retains the stats capability and pulls aggregate rows', async () => {
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/capabilities`) return jsonRes({ sync: true, stats: true });
      if (url === `${BASE}/sync/stats/pull?since=0`) {
        return jsonRes({ serverTime: 2, stats: [{ feed_id: 'feed-1', total_seen: 10, read_once: 3 }], markers: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    await expect(capabilities()).resolves.toEqual({ sync: true, stats: true });
    await expect(pullStats(TOKEN)).resolves.toEqual({
      serverTime: 2,
      stats: [{ feed_id: 'feed-1', total_seen: 10, read_once: 3 }],
      markers: [],
    });
  });

  it('reports an unavailable statistics endpoint distinctly', async () => {
    mockFetch(async (url) => {
      expect(url).toBe(`${BASE}/sync/stats/pull?since=0`);
      return new Response('Not Found', { status: 404 });
    });
    await expect(pullStats(TOKEN)).rejects.toMatchObject({
      status: 404,
      message: 'Statistics unavailable — this deployment does not support synced statistics',
    });
  });
});

describe('siftctl: feeds', () => {
  it('lists live feeds, excluding tombstones and URL duplicates', async () => {
    setTokenFile(TOKEN);
    mockFetch(async (url) => {
      expect(url).toBe(`${BASE}/sync/pull?since=0`);
      return jsonRes({
        serverTime: 1,
        feeds: [
          { feed_id: 'a', feed_url: 'https://x.com/a', title: 'A', deleted: 0, row_at: 1, folder: null, tags: null },
          { feed_id: 'b', feed_url: 'https://x.com/a', title: 'B-dup', deleted: 0, row_at: 2, folder: null, tags: null },
          { feed_id: 'c', feed_url: 'https://x.com/c', title: 'C', deleted: 1, row_at: 3, folder: null, tags: null },
        ],
        flags: [],
      });
    });
    const code = await runCli(['feeds', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.length).toBe(1);
    expect(parsed[0]).toMatchObject({ url: 'https://x.com/a', title: 'A' });
  });

  it('exits 1 with a not-paired message when no token is configured', async () => {
    const code = await runCli(['feeds']);
    expect(code).toBe(1);
    expect(stderr).toContain('Not paired');
  });
});

describe('siftctl: feed mutations', () => {
  it('feed add uses the URL as feed_id for a new subscription (bare values)', async () => {
    setTokenFile(TOKEN);
    const calls: Array<{ url: string; body?: string }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: String(init?.body) });
      if (url === `${BASE}/sync/pull?since=0`) {
        return jsonRes({ serverTime: 1, feeds: [], flags: [] });
      }
      if (url === `${BASE}/sync/push`) {
        return new Response(null, { status: 204 });
      }
      return jsonRes({}, 404);
    });
    const code = await runCli(['feed', 'add', 'https://x.com/new']);
    expect(code).toBe(0);
    const push = calls.find((c) => c.url === `${BASE}/sync/push`)!;
    expect(JSON.parse(push.body!)).toEqual({
      feeds: [{ feedId: 'https://x.com/new', feedUrl: 'https://x.com/new', deleted: 0 }],
    });
  });

  it('feed add reuses an existing feed_id from a pull', async () => {
    setTokenFile(TOKEN);
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/pull?since=0`) {
        return jsonRes({
          serverTime: 1,
          feeds: [{ feed_id: 'uuid-1', feed_url: 'https://x.com/existing', title: 'E', deleted: 0, row_at: 1, folder: null, tags: null }],
          flags: [],
        });
      }
      if (url === `${BASE}/sync/push`) {
        return new Response(null, { status: 204 });
      }
      return jsonRes({}, 404);
    });
    const code = await runCli(['feed', 'add', 'https://x.com/existing']);
    expect(code).toBe(0);
  });

  it('feed add includes discovered metadata and supports JSON output', async () => {
    setTokenFile(TOKEN);
    const calls: Array<{ url: string; body?: string }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: String(init?.body) });
      if (url === `${BASE}/sync/pull?since=0`) return jsonRes({ serverTime: 1, feeds: [], flags: [] });
      if (url === 'https://x.com/new') return new Response(FEED_XML, { status: 200 });
      if (url === `${BASE}/sync/push`) return new Response(null, { status: 204 });
      return jsonRes({}, 404);
    });
    const code = await runCli(['feed', 'add', 'https://x.com/new', '--json']);
    expect(code).toBe(0);
    const push = calls.find((call) => call.url === `${BASE}/sync/push`)!;
    expect(JSON.parse(push.body!)).toEqual({
      feeds: [{
        feedId: 'https://x.com/new',
        feedUrl: 'https://x.com/new',
        htmlUrl: 'https://x.com/',
        title: 'Example Feed',
        deleted: 0,
      }],
    });
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      operation: 'add',
      feedId: 'https://x.com/new',
      title: 'Example Feed',
    });
  });

  it('feed add gives explicit metadata precedence and normalizes tags', async () => {
    setTokenFile(TOKEN);
    const calls: Array<{ url: string; body?: string }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: String(init?.body) });
      if (url === `${BASE}/sync/pull?since=0`) return jsonRes({ serverTime: 1, feeds: [], flags: [] });
      if (url === 'https://x.com/new') return new Response(FEED_XML, { status: 200 });
      if (url === `${BASE}/sync/push`) return new Response(null, { status: 204 });
      return jsonRes({}, 404);
    });
    const code = await runCli(['feed', 'add', 'https://x.com/new', '--title', 'Custom', '--tags', 'AI, ai, Research Notes']);
    expect(code).toBe(0);
    const push = calls.find((call) => call.url === `${BASE}/sync/push`)!;
    expect(JSON.parse(push.body!)).toEqual({
      feeds: [{
        feedId: 'https://x.com/new',
        feedUrl: 'https://x.com/new',
        htmlUrl: 'https://x.com/',
        title: 'Custom',
        tags: ['ai', 'research notes'],
        deleted: 0,
      }],
    });
  });

  it('feed edit updates only requested metadata fields', async () => {
    setTokenFile(TOKEN);
    let pushed: unknown = null;
    mockFetch(async (url, init) => {
      if (url === `${BASE}/sync/pull?since=0`) {
        return jsonRes({
          serverTime: 1,
          feeds: [{ feed_id: 'uuid-1', feed_url: 'https://x.com/a', html_url: 'https://x.com', title: 'Old', tags: '["old"]', deleted: 0, row_at: 1 }],
          flags: [],
        });
      }
      if (url === `${BASE}/sync/push`) {
        pushed = JSON.parse(String(init?.body));
        return new Response(null, { status: 204 });
      }
      return jsonRes({}, 404);
    });
    const code = await runCli(['feed', 'edit', 'https://x.com/a', '--title', 'New', '--tags', 'AI, News', '--json']);
    expect(code).toBe(0);
    expect(pushed).toEqual({ feeds: [{ feedId: 'uuid-1', title: 'New', tags: ['ai', 'news'] }] });
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, operation: 'edit', feedId: 'uuid-1', title: 'New', tags: ['ai', 'news'] });
  });

  it('feed edit can clear title and tags', async () => {
    setTokenFile(TOKEN);
    let pushed: unknown = null;
    mockFetch(async (url, init) => {
      if (url === `${BASE}/sync/pull?since=0`) {
        return jsonRes({
          serverTime: 1,
          feeds: [{ feed_id: 'uuid-1', feed_url: 'https://x.com/a', title: 'Old', tags: '["old"]', deleted: 0, row_at: 1 }],
          flags: [],
        });
      }
      if (url === `${BASE}/sync/push`) {
        pushed = JSON.parse(String(init?.body));
        return new Response(null, { status: 204 });
      }
      return jsonRes({}, 404);
    });
    const code = await runCli(['feed', 'edit', 'https://x.com/a', '--title', '', '--tags', '']);
    expect(code).toBe(0);
    expect(pushed).toEqual({ feeds: [{ feedId: 'uuid-1', title: '', tags: [] }] });
  });

  it('feed remove does not tombstone an unknown URL', async () => {
    setTokenFile(TOKEN);
    let pushed = false;
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/pull?since=0`) return jsonRes({ serverTime: 1, feeds: [], flags: [] });
      if (url === `${BASE}/sync/push`) pushed = true;
      return new Response(null, { status: 204 });
    });
    const code = await runCli(['feed', 'remove', 'https://x.com/missing', '--yes']);
    expect(code).toBe(1);
    expect(pushed).toBe(false);
    expect(stderr).toContain('Not subscribed');
  });

  it('rejects invalid feed URLs before contacting the server', async () => {
    let called = false;
    mockFetch(async () => {
      called = true;
      return jsonRes({}, 500);
    });
    const code = await runCli(['feed', 'add', 'ftp://x.com/feed']);
    expect(code).toBe(2);
    expect(called).toBe(false);
  });

  it('feed remove requires --yes and does not contact the server without it', async () => {
    setTokenFile(TOKEN);
    let called = false;
    mockFetch(async () => {
      called = true;
      return jsonRes({}, 404);
    });
    const code = await runCli(['feed', 'remove', 'https://x.com/a']);
    expect(code).toBe(2);
    expect(called).toBe(false);
    expect(stderr).toContain('--yes');
  });

  it('feed remove tombstones the resolved feed_id with --yes', async () => {
    setTokenFile(TOKEN);
    const calls: Array<{ url: string; body?: string }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: String(init?.body) });
      if (url === `${BASE}/sync/pull?since=0`) {
        return jsonRes({
          serverTime: 1,
          feeds: [{ feed_id: 'uuid-1', feed_url: 'https://x.com/a', title: 'A', deleted: 0, row_at: 1, folder: null, tags: null }],
          flags: [],
        });
      }
      if (url === `${BASE}/sync/push`) {
        return new Response(null, { status: 204 });
      }
      return jsonRes({}, 404);
    });
    const code = await runCli(['feed', 'remove', 'https://x.com/a', '--yes']);
    expect(code).toBe(0);
    const push = calls.find((c) => c.url === `${BASE}/sync/push`)!;
    expect(JSON.parse(push.body!)).toEqual({
      feeds: [{ feedId: 'uuid-1', feedUrl: 'https://x.com/a', deleted: 1 }],
    });
  });
});

describe('siftctl: items and mark read', () => {
  it('parses items with browser-matching item IDs', async () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>X</title>
  <item><title>One</title><link>https://x.com/1</link><guid>guid-1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate><description>d</description></item>
  <item><title>Two</title><link>https://x.com/2</link><pubDate>Mon, 02 Jan 2024 00:00:00 GMT</pubDate><description>d</description></item>
</channel></rss>`;
    mockFetch(async (url) => {
      expect(url).toBe('https://x.com/feed.xml');
      return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    });
    const items = await fetchItems('https://x.com/feed.xml', 20);
    expect(items.length).toBe(2);
    expect(items[0].itemId).toBe(`${encodeURIComponent('https://x.com/feed.xml')}::guid-1`);
    expect(items[1].guid).toBe(`https://x.com/2|Mon, 02 Jan 2024 00:00:00 GMT`);
  });

  it('uses the synchronized feed ID for paired item output', async () => {
    setTokenFile(TOKEN);
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/pull?since=0`) {
        return jsonRes({
          serverTime: 1,
          feeds: [{ feed_id: 'uuid-1', feed_url: 'https://x.com/feed.xml', title: 'X', deleted: 0, row_at: 1 }],
          flags: [],
        });
      }
      if (url === 'https://x.com/feed.xml') return new Response(FEED_XML, { status: 200 });
      return jsonRes({}, 404);
    });
    const code = await runCli(['items', 'https://x.com/feed.xml', '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)[0].itemId).toBe('uuid-1::guid-1');
  });

  it('mark read pushes a read flag', async () => {
    setTokenFile(TOKEN);
    const itemId = `${encodeURIComponent('https://x.com/f')}::g`;
    let pushed: unknown = null;
    mockFetch(async (url, init) => {
      if (url === `${BASE}/sync/push`) {
        pushed = JSON.parse(String(init?.body));
        return new Response(null, { status: 204 });
      }
      return jsonRes({}, 404);
    });
    const code = await runCli(['mark', 'read', itemId]);
    expect(code).toBe(0);
    expect(pushed).toEqual({ flags: [{ itemId, feedId: 'https://x.com/f', read: 1 }] });
  });

  it('mark read supports JSON output', async () => {
    setTokenFile(TOKEN);
    const itemId = `${encodeURIComponent('https://x.com/f')}::g`;
    mockFetch(async (url) => {
      if (url === `${BASE}/sync/push`) return new Response(null, { status: 204 });
      return jsonRes({}, 404);
    });
    const code = await runCli(['mark', '--json', 'read', itemId]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ ok: true, operation: 'mark-read', itemId, read: true });
  });

  it('rejects unexpected mutation arguments without contacting the server', async () => {
    let called = false;
    mockFetch(async () => {
      called = true;
      return jsonRes({}, 500);
    });
    const code = await runCli(['feed', 'edit', 'https://x.com/f', '--title', 'X', 'extra']);
    expect(code).toBe(2);
    expect(called).toBe(false);
  });

  it('mark read rejects malformed item ids with a usage error', async () => {
    const code = await runCli(['mark', 'read', 'no-separator']);
    expect(code).toBe(2);
  });
});

describe('siftctl: exit codes', () => {
  it('unknown command exits 2', async () => {
    const code = await runCli(['frobnicate']);
    expect(code).toBe(2);
  });

  it('API errors exit 1', async () => {
    setTokenFile(TOKEN);
    mockFetch(async () => jsonRes({}, 500));
    const code = await runCli(['feeds', '--json']);
    expect(code).toBe(1);
    expect(stderr).toContain('Pull failed');
  });
});
