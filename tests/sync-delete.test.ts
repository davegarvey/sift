/**
 * Account deletion (DELETE /sync/account) and the daily retention of rotated
 * and inactive accounts, against Miniflare + real SQLite D1.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'path';
import { KEYED_RATE_LIMIT_PREFIXES, RATE_LIMITS } from '../server/sync/ratelimit';
import { RETENTION_MAX_ACCOUNTS_PER_RUN } from '../server/sync/cron';
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

const DAY_SECONDS = 24 * 60 * 60;
const DAILY_CRON = '0 3 * * *';

function makeSyncKey(label: string): string {
  return (label + 'xxxxxxxxxxxxxxxxxxxxxx').slice(0, 22).replace(/[^A-Za-z0-9_-]/g, 'x');
}

async function createMf(bindings: Record<string, string> = { FEED_POLLING: 'true' }): Promise<Miniflare> {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: workerCode,
    d1Databases: ['DB', 'POLL_DB'],
    bindings,
  }));
  await mf.ready;
  await applyPollMigration(mf, { maintainedAt: Date.now() });
  await mf.dispatchFetch('http://localhost/sync/capabilities');
  await (await mf.getD1Database('DB')).prepare(
    `CREATE TABLE IF NOT EXISTS feed_fetch_failures (
       feed_key TEXT PRIMARY KEY,
       status INTEGER NOT NULL,
       retry_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  ).run();
  return mf;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function api(mf: Miniflare, method: string, route: string, key: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (key) headers['X-Sync-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return mf.dispatchFetch(`http://localhost${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function register(mf: Miniflare, key: string): Promise<void> {
  expect((await api(mf, 'POST', '/sync/register', key)).status).toBe(204);
}

async function pushFeeds(mf: Miniflare, key: string, feeds: Array<{ feedId: string; feedUrl: string; deleted?: 0 | 1 }>): Promise<void> {
  const res = await api(mf, 'POST', '/sync/push', key, {
    feeds: feeds.map((f) => ({ feedId: f.feedId, feedUrl: f.feedUrl, title: f.feedId, deleted: f.deleted ?? 0 })),
  });
  expect(res.status).toBe(204);
}

async function db(mf: Miniflare): Promise<D1Database> {
  return mf.getD1Database('DB') as unknown as Promise<D1Database>;
}

async function pollDb(mf: Miniflare): Promise<D1Database> {
  return mf.getD1Database('POLL_DB') as unknown as Promise<D1Database>;
}

async function count(d: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await d.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

interface AccountRows {
  users: number;
  feeds: number;
  flags: number;
  feedStats: number;
  tokens: number;
  pairingCodes: number;
  rateLimits: number;
}

async function accountRows(mf: Miniflare, key: string): Promise<AccountRows> {
  const d = await db(mf);
  return {
    users: await count(d, 'SELECT COUNT(*) AS n FROM users WHERE sync_key = ?', key),
    feeds: await count(d, 'SELECT COUNT(*) AS n FROM feeds WHERE sync_key = ?', key),
    flags: await count(d, 'SELECT COUNT(*) AS n FROM flags WHERE sync_key = ?', key),
    feedStats: await count(d, 'SELECT COUNT(*) AS n FROM feed_stats WHERE sync_key = ?', key),
    tokens: await count(d, 'SELECT COUNT(*) AS n FROM tokens WHERE sync_key = ?', key),
    pairingCodes: await count(d, 'SELECT COUNT(*) AS n FROM pairing_codes WHERE sync_key = ?', key),
    rateLimits: await count(d, 'SELECT COUNT(*) AS n FROM rate_limits WHERE substr(scope, -22) = ?', key),
  };
}

const EMPTY_ROWS: AccountRows = { users: 0, feeds: 0, flags: 0, feedStats: 0, tokens: 0, pairingCodes: 0, rateLimits: 0 };

async function seedAccount(mf: Miniflare, key: string, label: string): Promise<{ token: string; agentCode: string }> {
  await register(mf, key);
  await pushFeeds(mf, key, [{ feedId: `${label}-feed`, feedUrl: `http://93.184.216.34/${label}.xml` }]);
  const itemId = `${encodeURIComponent(`${label}-feed`)}::article-1`;
  const flags = await api(mf, 'POST', '/sync/push', key, {
    flags: [{ itemId, feedId: `${label}-feed`, read: 1, starred: 1 }],
  });
  expect(flags.status).toBe(204);
  const stats = await api(mf, 'POST', '/sync/stats/push', key, {
    stats: [{ feedId: `${label}-feed`, totalSeen: 4 }],
    markers: [{ itemId, feedId: `${label}-feed` }],
  });
  expect(stats.status).toBe(200);
  expect((await api(mf, 'POST', '/sync/otp', key)).status).toBe(200);
  expect((await api(mf, 'GET', '/sync/pull?since=0', key)).status).toBe(200);
  const minted = (await (await api(mf, 'POST', '/sync/tokens', key)).json()) as { code: string };
  const redeemed = await api(mf, 'POST', '/sync/tokens/redeem', null, { code: minted.code });
  expect(redeemed.status).toBe(200);
  const { token } = (await redeemed.json()) as { token: string };
  const agentCode = ((await (await api(mf, 'POST', '/sync/tokens', key)).json()) as { code: string }).code;
  return { token, agentCode };
}

async function runDailyCron(mf: Miniflare): Promise<void> {
  const worker = await mf.getWorker();
  const result = await worker.scheduled({ cron: DAILY_CRON, scheduledTime: new Date() });
  expect(result.outcome).toBe('ok');
}

describe('DELETE /sync/account', () => {
  it('deletes every row keyed by the sync key and leaves other accounts untouched', async () => {
    const mf = await createMf();
    try {
      const alice = makeSyncKey('del-alice');
      const bob = makeSyncKey('del-bob');
      await seedAccount(mf, alice, 'alice');
      const bobSeed = await seedAccount(mf, bob, 'bob');

      const before = await accountRows(mf, alice);
      expect(before.users).toBe(1);
      expect(before.feeds).toBe(1);
      expect(before.flags).toBe(1);
      expect(before.feedStats).toBe(1);
      expect(before.tokens).toBe(1);
      expect(before.pairingCodes).toBeGreaterThanOrEqual(2);
      expect(before.rateLimits).toBeGreaterThan(0);
      const bobBefore = await accountRows(mf, bob);

      const shared = await db(mf);
      await shared
        .prepare('INSERT INTO feed_fetch_failures (feed_key, status, retry_at, updated_at) VALUES (?, 429, ?, ?)')
        .bind('shared-key', Date.now() + 60_000, Date.now())
        .run();

      const res = await api(mf, 'DELETE', '/sync/account', alice);
      expect(res.status).toBe(204);

      expect(await accountRows(mf, alice)).toEqual(EMPTY_ROWS);
      expect(await accountRows(mf, bob)).toEqual(bobBefore);
      expect(await count(shared, 'SELECT COUNT(*) AS n FROM feed_fetch_failures')).toBe(1);
      expect(await count(shared, 'SELECT COUNT(*) AS n FROM counters WHERE name = ?', 'server_time')).toBe(1);

      expect((await api(mf, 'GET', '/sync/pull?since=0', bob)).status).toBe(200);
      expect((await api(mf, 'GET', '/sync/pull?since=0', bobSeed.token)).status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });

  it('is refused with 401 on repeat and changes nothing', async () => {
    const mf = await createMf();
    try {
      const alice = makeSyncKey('rep-alice');
      const bob = makeSyncKey('rep-bob');
      await seedAccount(mf, alice, 'alice');
      await seedAccount(mf, bob, 'bob');
      const bobBefore = await accountRows(mf, bob);

      expect((await api(mf, 'DELETE', '/sync/account', alice)).status).toBe(204);
      expect((await api(mf, 'DELETE', '/sync/account', alice)).status).toBe(401);

      expect(await accountRows(mf, alice)).toEqual(EMPTY_ROWS);
      expect(await accountRows(mf, bob)).toEqual(bobBefore);
      expect((await api(mf, 'GET', '/sync/pull?since=0', alice)).status).toBe(401);
      expect((await api(mf, 'POST', '/sync/push', alice, { feeds: [] })).status).toBe(401);
    } finally {
      await mf.dispose();
    }
  });

  it('rejects missing, malformed, unknown and agent-token credentials', async () => {
    const mf = await createMf();
    try {
      const alice = makeSyncKey('auth-alice');
      const { token } = await seedAccount(mf, alice, 'alice');
      const before = await accountRows(mf, alice);

      expect((await api(mf, 'DELETE', '/sync/account', null)).status).toBe(401);
      expect((await api(mf, 'DELETE', '/sync/account', 'short')).status).toBe(401);
      expect((await api(mf, 'DELETE', '/sync/account', makeSyncKey('auth-unknown'))).status).toBe(401);
      expect((await api(mf, 'DELETE', '/sync/account', token)).status).toBe(401);
      expect((await api(mf, 'OPTIONS', '/sync/account', null)).status).toBe(403);

      expect(await accountRows(mf, alice)).toEqual(before);
    } finally {
      await mf.dispose();
    }
  });

  it('is rate-limited per sync key', async () => {
    const mf = await createMf();
    try {
      const alice = makeSyncKey('rl-alice');
      await seedAccount(mf, alice, 'alice');
      const before = await accountRows(mf, alice);
      const { windowSeconds, limit } = RATE_LIMITS.accountDelete;
      const windowStart = Math.floor(nowSeconds() / windowSeconds) * windowSeconds;
      await (await db(mf))
        .prepare('INSERT INTO rate_limits (scope, window_start, count) VALUES (?, ?, ?)')
        .bind(`account-delete:${alice}`, windowStart, limit)
        .run();

      const res = await api(mf, 'DELETE', '/sync/account', alice);
      expect(res.status).toBe(429);
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect((await accountRows(mf, alice)).users).toBe(1);
      expect((await accountRows(mf, alice)).feeds).toBe(before.feeds);
    } finally {
      await mf.dispose();
    }
  });

  it('revokes agent tokens and agent pairing codes immediately', async () => {
    const mf = await createMf();
    try {
      const alice = makeSyncKey('tok-alice');
      const { token } = await seedAccount(mf, alice, 'alice');
      expect((await api(mf, 'GET', '/sync/pull?since=0', token)).status).toBe(200);
      expect((await accountRows(mf, alice)).pairingCodes).toBeGreaterThan(0);

      expect((await api(mf, 'DELETE', '/sync/account', alice)).status).toBe(204);

      expect((await api(mf, 'GET', '/sync/pull?since=0', token)).status).toBe(401);
      expect((await api(mf, 'POST', '/sync/push', token, { feeds: [] })).status).toBe(401);
      expect((await accountRows(mf, alice)).pairingCodes).toBe(0);
      expect((await accountRows(mf, alice)).tokens).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('does not delete rate-limit rows scoped to other keys or addresses', async () => {
    const mf = await createMf();
    try {
      const alice = makeSyncKey('rl2-alice');
      const bob = makeSyncKey('rl2-bob');
      await seedAccount(mf, alice, 'alice');
      await seedAccount(mf, bob, 'bob');
      const shared = await db(mf);
      const before = await count(shared, 'SELECT COUNT(*) AS n FROM rate_limits WHERE substr(scope, -22) != ?', alice);
      expect(before).toBeGreaterThan(0);

      expect((await api(mf, 'DELETE', '/sync/account', alice)).status).toBe(204);

      expect(await count(shared, 'SELECT COUNT(*) AS n FROM rate_limits WHERE substr(scope, -22) != ?', alice)).toBe(before);
    } finally {
      await mf.dispose();
    }
  });

  it('removes keyed rate-limit scopes used by every route', () => {
    const source = ['../server/sync/routes.ts', '../server/agent/oauth/decisions.ts']
      .map((file) => readFileSync(path.resolve(__dirname, file), 'utf8'))
      .join('\n');
    const prefixes = new Set<string>();
    for (const match of source.matchAll(/`([a-z][a-z:-]*):\$\{(?:syncKey|oldKey)\}`/g)) prefixes.add(match[1]);
    for (const match of source.matchAll(/rateLimitKey\(ctx, '([a-z][a-z:-]*)'\)/g)) prefixes.add(match[1]);
    prefixes.add('discover');
    expect([...prefixes].sort()).toEqual([...KEYED_RATE_LIMIT_PREFIXES].sort());
  });
});

describe('DELETE /sync/account and polling', () => {
  async function seedPolling(mf: Miniflare) {
    const alice = makeSyncKey('poll-alice');
    const bob = makeSyncKey('poll-bob');
    const shared = 'http://93.184.216.34/shared.xml';
    const aliceOnly = 'http://93.184.216.34/alice-only.xml';
    const privateFeed = 'http://93.184.216.34/private.xml?token=secret';
    const bobTombstone = 'http://93.184.216.34/alice-only.xml';
    await register(mf, alice);
    await register(mf, bob);
    await pushFeeds(mf, alice, [
      { feedId: 'a-shared', feedUrl: shared },
      { feedId: 'a-only', feedUrl: aliceOnly },
      { feedId: 'a-private', feedUrl: privateFeed },
    ]);
    await pushFeeds(mf, bob, [{ feedId: 'b-shared', feedUrl: shared }]);
    await pushFeeds(mf, bob, [{ feedId: 'b-gone', feedUrl: bobTombstone, deleted: 1 }]);
    const poll = await pollDb(mf);
    for (const url of [shared, aliceOnly, privateFeed]) {
      await poll
        .prepare('INSERT INTO polled_items (feed_url, guid, title, excerpt, first_seen_at) VALUES (?, ?, ?, ?, ?)')
        .bind(url, 'g1', 'Title', 'Excerpt', Date.now())
        .run();
    }
    return { alice, bob, shared, aliceOnly, privateFeed };
  }

  async function polledUrls(mf: Miniflare, table: 'polled_feeds' | 'polled_items'): Promise<string[]> {
    const rows = await (await pollDb(mf))
      .prepare(`SELECT DISTINCT feed_url FROM ${table} ORDER BY feed_url`)
      .all<{ feed_url: string }>();
    return rows.results.map((row) => row.feed_url);
  }

  it('removes polling state no other account needs and keeps shared state', async () => {
    const mf = await createMf();
    try {
      const { alice, shared, aliceOnly, privateFeed } = await seedPolling(mf);
      expect(await polledUrls(mf, 'polled_feeds')).toEqual([aliceOnly, privateFeed, shared].sort());

      expect((await api(mf, 'DELETE', '/sync/account', alice)).status).toBe(204);

      expect(await polledUrls(mf, 'polled_feeds')).toEqual([shared]);
      expect(await polledUrls(mf, 'polled_items')).toEqual([shared]);
    } finally {
      await mf.dispose();
    }
  });

  it('leaves the registry correct after the next maintenance pass', async () => {
    const mf = await createMf();
    try {
      const { alice, bob, shared } = await seedPolling(mf);
      await api(mf, 'GET', '/sync/pull?since=0', bob);
      await api(mf, 'GET', '/sync/pull?since=0', alice);
      expect((await api(mf, 'DELETE', '/sync/account', alice)).status).toBe(204);

      await (await pollDb(mf)).prepare("DELETE FROM poll_meta WHERE key = 'maintained_at'").run();
      const worker = await mf.getWorker();
      await worker.scheduled({ cron: '*/10 * * * *', scheduledTime: new Date() });

      expect(await polledUrls(mf, 'polled_feeds')).toEqual([shared]);
    } finally {
      await mf.dispose();
    }
  });

  it('still deletes the account when polling state cannot be updated, and maintenance cleans up', async () => {
    const mf = await createMf();
    try {
      const { alice, bob, shared } = await seedPolling(mf);
      await api(mf, 'GET', '/sync/pull?since=0', bob);
      const poll = await pollDb(mf);
      await poll.prepare('ALTER TABLE polled_items RENAME TO polled_items_hidden').run();

      expect((await api(mf, 'DELETE', '/sync/account', alice)).status).toBe(204);
      expect((await accountRows(mf, alice)).users).toBe(0);
      expect((await polledUrls(mf, 'polled_feeds')).length).toBe(3);

      await poll.prepare('ALTER TABLE polled_items_hidden RENAME TO polled_items').run();
      await poll.prepare("DELETE FROM poll_meta WHERE key = 'maintained_at'").run();
      const worker = await mf.getWorker();
      await worker.scheduled({ cron: '*/10 * * * *', scheduledTime: new Date() });
      expect(await polledUrls(mf, 'polled_feeds')).toEqual([shared]);
    } finally {
      await mf.dispose();
    }
  });

  it('succeeds without a poll database', async () => {
    const mf = await createMf({});
    try {
      const alice = makeSyncKey('nopoll-alice');
      await seedAccount(mf, alice, 'alice');
      expect((await api(mf, 'DELETE', '/sync/account', alice)).status).toBe(204);
      expect(await accountRows(mf, alice)).toEqual(EMPTY_ROWS);
    } finally {
      await mf.dispose();
    }
  });
});

describe('account activity', () => {
  it('records pull activity without server polling, at most hourly', async () => {
    const mf = await createMf({});
    try {
      const key = makeSyncKey('activity-1');
      await register(mf, key);
      const d = await db(mf);
      const read = () => d.prepare('SELECT last_active_at FROM users WHERE sync_key = ?').bind(key).first<{ last_active_at: number | null }>();
      expect((await read())?.last_active_at ?? null).toBeNull();

      await api(mf, 'GET', '/sync/pull?since=0', key);
      const first = (await read())?.last_active_at ?? 0;
      expect(first).toBeGreaterThan(nowSeconds() - 60);

      await d.prepare('UPDATE users SET last_active_at = ? WHERE sync_key = ?').bind(first - 10, key).run();
      await api(mf, 'GET', '/sync/pull?since=0', key);
      expect((await read())?.last_active_at).toBe(first - 10);
    } finally {
      await mf.dispose();
    }
  });
});

describe('retention in the daily cron', () => {
  async function accountExists(mf: Miniflare, key: string): Promise<boolean> {
    return (await accountRows(mf, key)).users === 1;
  }

  async function setUser(mf: Miniflare, key: string, fields: { created_at?: number; last_active_at?: number | null; rotated_at?: number | null }): Promise<void> {
    const d = await db(mf);
    for (const [column, value] of Object.entries(fields)) {
      await d.prepare(`UPDATE users SET ${column} = ? WHERE sync_key = ?`).bind(value, key).run();
    }
  }

  it('deletes accounts inactive for 12 months and rotated for 30 days, with their rows, and keeps the rest', async () => {
    const mf = await createMf({});
    try {
      const now = nowSeconds();
      const accounts = {
        inactive: makeSyncKey('ret-inactive'),
        neverActiveOld: makeSyncKey('ret-neveroldd'),
        neverActiveNew: makeSyncKey('ret-nevernew'),
        activeRecently: makeSyncKey('ret-active'),
        quietElevenMonths: makeSyncKey('ret-eleven'),
        oldButActive: makeSyncKey('ret-oldactive'),
        rotatedOld: makeSyncKey('ret-rotatedold'),
        rotatedRecent: makeSyncKey('ret-rotatednew'),
        rotatedOldAndRecentlyActive: makeSyncKey('ret-rotactive'),
      };
      for (const [label, key] of Object.entries(accounts)) await seedAccount(mf, key, label);
      const d = await db(mf);
      await d.prepare('UPDATE users SET last_active_at = NULL').run();
      await d.prepare('UPDATE rate_limits SET window_start = window_start - ?').bind(3 * DAY_SECONDS).run();

      await setUser(mf, accounts.inactive, { created_at: now - 500 * DAY_SECONDS, last_active_at: now - 366 * DAY_SECONDS });
      await setUser(mf, accounts.neverActiveOld, { created_at: now - 400 * DAY_SECONDS, last_active_at: null });
      await setUser(mf, accounts.neverActiveNew, { created_at: now - 10 * DAY_SECONDS, last_active_at: null });
      await setUser(mf, accounts.activeRecently, { created_at: now - 700 * DAY_SECONDS, last_active_at: now - DAY_SECONDS });
      await setUser(mf, accounts.quietElevenMonths, { created_at: now - 700 * DAY_SECONDS, last_active_at: now - 330 * DAY_SECONDS });
      await setUser(mf, accounts.oldButActive, { created_at: now - 900 * DAY_SECONDS, last_active_at: now - 5 * DAY_SECONDS });
      await setUser(mf, accounts.rotatedOld, { rotated_at: now - 31 * DAY_SECONDS });
      await setUser(mf, accounts.rotatedRecent, { rotated_at: now - 29 * DAY_SECONDS });
      await setUser(mf, accounts.rotatedOldAndRecentlyActive, { rotated_at: now - 40 * DAY_SECONDS, last_active_at: now - DAY_SECONDS });

      await runDailyCron(mf);

      const deleted = [accounts.inactive, accounts.neverActiveOld, accounts.rotatedOld, accounts.rotatedOldAndRecentlyActive];
      const kept = [accounts.neverActiveNew, accounts.activeRecently, accounts.quietElevenMonths, accounts.oldButActive, accounts.rotatedRecent];
      for (const key of deleted) expect(await accountRows(mf, key), key).toEqual({ ...EMPTY_ROWS });
      for (const key of kept) {
        const rows = await accountRows(mf, key);
        expect(rows.users, key).toBe(1);
        expect(rows.feeds, key).toBe(1);
        expect(rows.flags, key).toBe(1);
        expect(rows.feedStats, key).toBe(1);
        expect(rows.tokens, key).toBe(1);
      }
    } finally {
      await mf.dispose();
    }
  }, 15_000);

  it('deletes at most RETENTION_MAX_ACCOUNTS_PER_RUN accounts per run and finishes the backlog later', async () => {
    const mf = await createMf({});
    try {
      const d = await db(mf);
      const total = RETENTION_MAX_ACCOUNTS_PER_RUN + 5;
      const rotatedAt = nowSeconds() - 60 * DAY_SECONDS;
      const keys = Array.from({ length: total }, (_, i) => `backlog${String(i).padStart(15, '0')}`);
      await d.batch(keys.flatMap((key) => [
        d.prepare('INSERT INTO users (sync_key, created_at, rotated_at) VALUES (?, ?, ?)').bind(key, rotatedAt - DAY_SECONDS, rotatedAt),
        d.prepare('INSERT INTO feeds (sync_key, feed_id, feed_url, deleted, row_at) VALUES (?, ?, ?, 0, 1)').bind(key, 'f', 'http://93.184.216.34/x.xml'),
      ]));

      await runDailyCron(mf);
      expect(await count(d, 'SELECT COUNT(*) AS n FROM users')).toBe(5);
      expect(await count(d, 'SELECT COUNT(*) AS n FROM feeds')).toBe(5);

      await runDailyCron(mf);
      expect(await count(d, 'SELECT COUNT(*) AS n FROM users')).toBe(0);
      expect(await count(d, 'SELECT COUNT(*) AS n FROM feeds')).toBe(0);
    } finally {
      await mf.dispose();
    }
  });

  it('leaves a recently rotated account usable by its new key and deletes the old one later', async () => {
    const mf = await createMf({});
    try {
      const oldKey = makeSyncKey('rot-old');
      const newKey = makeSyncKey('rot-new');
      await seedAccount(mf, oldKey, 'old');
      expect((await api(mf, 'POST', '/sync/rotate', oldKey, { sync_key: newKey })).status).toBe(204);
      await runDailyCron(mf);
      expect(await accountExists(mf, oldKey)).toBe(true);
      expect(await accountExists(mf, newKey)).toBe(true);

      await setUser(mf, oldKey, { rotated_at: nowSeconds() - 31 * DAY_SECONDS });
      await runDailyCron(mf);
      expect(await accountExists(mf, oldKey)).toBe(false);
      expect((await accountRows(mf, oldKey)).feeds).toBe(0);
      expect(await accountExists(mf, newKey)).toBe(true);
      expect((await api(mf, 'GET', '/sync/pull?since=0', newKey)).status).toBe(200);
    } finally {
      await mf.dispose();
    }
  });
});
