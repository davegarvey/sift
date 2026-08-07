import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCli } from '../packages/siftctl/src/cli';
import { tokenFingerprint } from '../packages/siftctl/src/fingerprint';
import { fetchItems } from '../packages/siftctl/src/items';

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

describe('siftctl: status', () => {
  it('reports capabilities, URL, and token fingerprint', async () => {
    setTokenFile(TOKEN);
    mockFetch(async (url) => {
      expect(url).toBe(`${BASE}/sync/capabilities`);
      return jsonRes({ sync: true });
    });
    const code = await runCli(['status', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.sync).toBe(true);
    expect(parsed.url).toBe(BASE);
    expect(parsed.paired).toBe(true);
    expect(parsed.fingerprint).toBe(await tokenFingerprint(TOKEN));
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
