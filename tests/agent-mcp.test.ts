import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/handle';
import { clearFeedCacheForTests } from '../server/fetch';
import { clearOriginGovernorForTests } from '../server/origin-governor';
import { openNodeSqlite } from '../server/node-sqlite';
import { createSelfHostedDatabases } from '../server/sqlite-d1';
import { generateToken, generateTokenId, sha256Hex, tokenFingerprint } from '../server/sync/tokens';
import { RATE_LIMITS } from '../server/sync/ratelimit';
import { validateSchema, type Schema } from '../server/agent/mcp/schema';
import { redactUrl } from '../server/agent/mcp/redact';
import { htmlToMarkdown } from '../server/agent/mcp/markdown';
import { publicOrigin } from '../server/agent/origin';
import { buildStats } from '../server/agent/mcp/stats';

const SITE = 'http://93.184.216.34';
const SYNC_KEY = 'a'.repeat(22);
const directories: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearFeedCacheForTests();
  clearOriginGovernorForTests();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

interface Harness {
  app: ReturnType<typeof createApp>;
  sync: D1Database;
  poll: D1Database;
  token: string;
  tokenId: string;
}

async function addToken(sync: D1Database, scopes: string, expiresAt?: number | null): Promise<{ token: string; tokenId: string }> {
  const token = generateToken();
  const tokenId = generateTokenId();
  const now = Math.floor(Date.now() / 1000);
  await sync
    .prepare(
      `INSERT INTO tokens
         (token_id, token_hash, sync_key, scope, fingerprint, created_at, origin, client_id, client_name, scopes, expires_at, refresh_hash, refresh_expires_at, family_id)
       VALUES (?, ?, ?, 'rw', ?, ?, 'oauth', 'client-1', 'Test Agent', ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenId,
      await sha256Hex(token),
      SYNC_KEY,
      await tokenFingerprint(token),
      now,
      scopes,
      expiresAt === undefined ? now + 3600 : expiresAt,
      await sha256Hex(`refresh-${tokenId}`),
      now + 86_400,
      `family-${tokenId}`,
    )
    .run();
  return { token, tokenId };
}

async function setup(options: { scopes?: string; polling?: boolean; publicUrl?: string } = {}): Promise<Harness> {
  const directory = mkdtempSync(join(tmpdir(), 'sift-mcp-'));
  directories.push(directory);
  const databases = await createSelfHostedDatabases(directory, openNodeSqlite);
  const sync = databases.sync as unknown as D1Database;
  const poll = databases.poll as unknown as D1Database;
  await sync.prepare('INSERT INTO users (sync_key, created_at) VALUES (?, ?)').bind(SYNC_KEY, 1).run();
  const app = createApp({
    db: sync,
    pollDb: options.polling === false ? undefined : poll,
    publicUrl: options.publicUrl,
  });
  const { token, tokenId } = await addToken(sync, options.scopes ?? 'read write');
  return { app, sync, poll, token, tokenId };
}

interface RpcResponse {
  jsonrpc: '2.0';
  id: number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function rpc(h: Harness, method: string, params?: unknown, path = '/mcp', token = h.token): Promise<RpcResponse> {
  const res = await h.app.request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await res.json()) as RpcResponse;
}

interface ToolResponse {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}

async function call(h: Harness, name: string, args: Record<string, unknown> = {}): Promise<ToolResponse> {
  const res = await rpc(h, 'tools/call', { name, arguments: args });
  expect(res.error).toBeUndefined();
  return res.result as unknown as ToolResponse;
}

async function data<T = Record<string, unknown>>(h: Harness, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await call(h, name, args);
  expect(result.isError, result.content[0]?.text).toBeFalsy();
  return result.structuredContent as T;
}

async function push(h: Harness, body: unknown): Promise<void> {
  const res = await h.app.request('/sync/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${h.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(204);
}

async function seedStats(h: Harness, feedId: string, totalSeen: number, readOnce: number): Promise<void> {
  await h.sync
    .prepare('INSERT INTO feed_stats (sync_key, feed_id, total_seen, read_once, row_at) VALUES (?, ?, ?, ?, 1)')
    .bind(SYNC_KEY, feedId, totalSeen, readOnce)
    .run();
}

interface SeedItem {
  feedUrl: string;
  guid: string;
  title: string;
  excerpt?: string;
  html?: string | null;
  link?: string | null;
  publishedAt?: number | null;
  firstSeenAt?: number;
}

async function seedItems(h: Harness, items: SeedItem[]): Promise<void> {
  for (const item of items) {
    await h.poll
      .prepare(
        `INSERT INTO polled_items (feed_url, guid, title, link, author, published_at, excerpt, html, first_seen_at)
         VALUES (?, ?, ?, ?, 'Ada', ?, ?, ?, ?)`,
      )
      .bind(
        item.feedUrl,
        item.guid,
        item.title,
        item.link ?? null,
        item.publishedAt === undefined ? Date.now() : item.publishedAt,
        item.excerpt ?? '',
        item.html ?? null,
        item.firstSeenAt ?? Date.now(),
      )
      .run();
  }
}

function rss(title: string, items: Array<{ title: string; date?: string }>, link = SITE): string {
  const entries = items
    .map(
      (item, index) =>
        `<item><title>${item.title}</title><link>${link}/post-${index}</link><guid>${link}/post-${index}</guid>${item.date ? `<pubDate>${item.date}</pubDate>` : ''}<description>Body ${index}</description></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><link>${link}</link><description>d</description>${entries}</channel></rss>`;
}

type Route = { status?: number; body?: string; type?: string };

function stubUpstream(routes: Record<string, Route>): string[] {
  const requested: string[] = [];
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(route.body ?? '', {
      status: route.status ?? 200,
      headers: { 'Content-Type': route.type ?? 'application/xml' },
    });
  }) as typeof globalThis.fetch);
  return requested;
}

async function withTimers<T>(work: Promise<T>): Promise<T> {
  let done = false;
  const wrapped = work.finally(() => {
    done = true;
  });
  while (!done) await vi.advanceTimersByTimeAsync(500);
  return wrapped;
}

interface ListedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  outputSchema: Schema;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
}

async function listTools(h: Harness): Promise<ListedTool[]> {
  const res = await rpc(h, 'tools/list');
  return (res.result as { tools: ListedTool[] }).tools;
}

describe('MCP endpoint', () => {
  it('answers an unauthenticated request with the protected-resource challenge', async () => {
    const h = await setup();
    const res = await h.app.request('http://sift.test/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="http://sift.test/.well-known/oauth-protected-resource"',
    );
  });

  it('points the connection alias at its per-connection metadata', async () => {
    const h = await setup();
    const res = await h.app.request('http://sift.test/mcp/c/abc123', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="http://sift.test/.well-known/oauth-protected-resource/mcp/c/abc123"',
    );
  });

  it('uses the configured public URL and rejects invalid, expired and master credentials', async () => {
    const h = await setup({ publicUrl: 'https://sift.example.com/ignored' });
    const expired = await addToken(h.sync, 'read write', Math.floor(Date.now() / 1000) - 10);
    for (const credential of ['tnotavalidtokenxxxxxxxx', expired.token, SYNC_KEY]) {
      const res = await h.app.request('http://internal:8787/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}` },
        body: '{}',
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toBe(
        'Bearer resource_metadata="https://sift.example.com/.well-known/oauth-protected-resource"',
      );
    }
    const aliasRes = await h.app.request('http://internal:8787/mcp/c/xyz', { method: 'POST', body: '{}' });
    expect(aliasRes.headers.get('WWW-Authenticate')).toContain('https://sift.example.com/.well-known/oauth-protected-resource/mcp/c/xyz');
    expect(publicOrigin('http://a.test/x', 'https://b.test/y')).toBe('https://b.test');
    expect(publicOrigin('http://a.test/x')).toBe('http://a.test');
  });

  it('returns 405 for GET and handles CORS preflight', async () => {
    const h = await setup();
    for (const path of ['/mcp', '/mcp/c/abc']) {
      const get = await h.app.request(path, { headers: { Authorization: `Bearer ${h.token}` } });
      expect(get.status).toBe(405);
      const preflight = await h.app.request(path, { method: 'OPTIONS' });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(preflight.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
      expect(preflight.headers.get('Access-Control-Allow-Headers')).toMatch(/Content-Type/);
      expect(preflight.headers.get('Access-Control-Allow-Methods')).toMatch(/POST/);
    }
  });

  it('serves the alias identically to /mcp, ignoring the ID', async () => {
    const h = await setup();
    const main = await rpc(h, 'tools/list');
    const alias = await rpc(h, 'tools/list', undefined, '/mcp/c/spent-id');
    expect(alias).toEqual(main);
  });

  it('negotiates the protocol version and carries workflow instructions', async () => {
    const h = await setup();
    for (const version of ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']) {
      const res = await rpc(h, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 't', version: '1' } });
      expect((res.result as { protocolVersion: string }).protocolVersion).toBe(version);
    }
    const fallback = await rpc(h, 'initialize', { protocolVersion: '1999-01-01' });
    expect((fallback.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
    const result = fallback.result as { instructions: string; capabilities: { tools: object }; serverInfo: { name: string } };
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo.name).toBe('sift');
    for (const phrase of ['engagement', 'discover_feeds', 'list_subscriptions', 'list_items', 'get_item', 'feedId', '<feedId>::<guid>']) {
      expect(result.instructions).toContain(phrase);
    }
    expect(result.instructions).toMatch(/verify/i);
  });

  it('accepts notifications with 202, answers ping and rejects bad JSON and unknown methods', async () => {
    const h = await setup();
    const notification = await h.app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${h.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(notification.status).toBe(202);
    expect((await rpc(h, 'ping')).result).toEqual({});
    expect((await rpc(h, 'nope')).error?.code).toBe(-32601);
    const bad = await h.app.request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${h.token}` }, body: '{' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as RpcResponse).error?.code).toBe(-32700);
    const unknownTool = await rpc(h, 'tools/call', { name: 'nope', arguments: {} });
    expect(unknownTool.error?.code).toBe(-32602);
  });
});

describe('tool listing and scopes', () => {
  it('lists every tool with schemas and annotations for a full grant', async () => {
    const h = await setup();
    const tools = await listTools(h);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'discover_feeds', 'get_item', 'get_reading_stats', 'list_items', 'list_subscriptions',
      'set_item_state', 'subscribe', 'unsubscribe', 'update_subscription',
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema.type).toBe('object');
      expect(Object.keys(tool.annotations).sort()).toEqual(['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint', 'title']);
    }
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));
    expect(byName.unsubscribe).toMatchObject({ destructiveHint: true, idempotentHint: true, readOnlyHint: false });
    expect(byName.discover_feeds).toMatchObject({ openWorldHint: true, readOnlyHint: true });
    expect(byName.list_subscriptions).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(byName.subscribe).toMatchObject({ idempotentHint: true, readOnlyHint: false });
  });

  it('hides write tools from a read-only grant and refuses calls to them', async () => {
    const h = await setup({ scopes: 'read' });
    const names = (await listTools(h)).map((tool) => tool.name);
    expect(names).toContain('list_subscriptions');
    for (const hidden of ['subscribe', 'update_subscription', 'unsubscribe', 'set_item_state']) {
      expect(names).not.toContain(hidden);
    }
    await push({ ...h, token: (await addToken(h.sync, 'read write')).token }, {
      feeds: [{ feedId: 'f1', feedUrl: `${SITE}/f1.xml`, title: 'One', deleted: 0 }],
    });
    const refused = await call(h, 'unsubscribe', { feedId: 'f1' });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/insufficient_scope/);
    expect((await data<{ total: number }>(h, 'list_subscriptions')).total).toBe(1);
  });

  it('hides content tools and says so when polling is unavailable', async () => {
    const h = await setup({ polling: false });
    const names = (await listTools(h)).map((tool) => tool.name);
    expect(names).not.toContain('list_items');
    expect(names).not.toContain('get_item');
    expect(names).toContain('list_subscriptions');
    const init = await rpc(h, 'initialize', { protocolVersion: '2025-11-25' });
    expect((init.result as { instructions: string }).instructions).toMatch(/unavailable on this deployment/);
    const refused = await rpc(h, 'tools/call', { name: 'list_items', arguments: {} });
    expect(refused.error?.code).toBe(-32602);
  });

  it('rejects arguments that break the input schema', async () => {
    const h = await setup();
    const result = await call(h, 'list_items', { limit: 500 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid arguments/);
    expect((await call(h, 'set_item_state', { itemIds: [], read: true })).isError).toBe(true);
  });
});

describe('redaction', () => {
  it('redacts the specification example', () => {
    expect(redactUrl('https://user:pw@example.com/feed?token=abc&page=2')).toBe('https://example.com/feed?token=REDACTED&page=2');
  });

  it('strips userinfo and redacts every sensitive parameter name case-insensitively', () => {
    expect(redactUrl('https://me@example.com/a')).toBe('https://example.com/a');
    expect(redactUrl('https://example.com/f?Token=1&API_KEY=2&client_secret=3&Auth=4&password=5&sig=6&sessionid=7&code=8&x=9')).toBe(
      'https://example.com/f?Token=REDACTED&API_KEY=REDACTED&client_secret=REDACTED&Auth=REDACTED&password=REDACTED&sig=REDACTED&sessionid=REDACTED&code=REDACTED&x=9',
    );
    expect(redactUrl('https://example.com/f?a%2Dtoken=1')).toBe('https://example.com/f?a%2Dtoken=REDACTED');
    expect(redactUrl('https://example.com/f#access_token=abc')).toBe('https://example.com/f#access_token=REDACTED');
    expect(redactUrl('https://example.com/plain?page=2#top')).toBe('https://example.com/plain?page=2#top');
  });

  it('redacts URLs in every tool output', async () => {
    const h = await setup();
    const secretUrl = 'https://user:pw@feeds.example.com/private.xml?token=abc&page=2';
    await push(h, {
      feeds: [{ feedId: 'f1', feedUrl: secretUrl, htmlUrl: 'https://me:pw@example.com/?key=zzz', title: 'Private', deleted: 0 }],
    });
    await seedItems(h, [{
      feedUrl: secretUrl,
      guid: 'g1',
      title: 'Hello',
      link: 'https://user:pw@feeds.example.com/p?sig=1',
      html: '<p><a href="https://u:p@e.example.com/x?code=9">link</a> <img src="https://i.example.com/a.png?auth=1" alt="pic"></p>',
    }]);
    const all = [
      await call(h, 'list_subscriptions'),
      await call(h, 'get_reading_stats'),
      await call(h, 'list_items'),
      await call(h, 'get_item', { itemId: 'f1::g1' }),
    ];
    for (const result of all) {
      expect(result.isError).toBeFalsy();
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain('pw@');
      expect(serialised).not.toContain('=abc');
      expect(serialised).not.toContain('=zzz');
      expect(serialised).not.toContain('=9');
    }
    const subs = (await data<{ subscriptions: Array<{ feedUrl: string; siteUrl: string }> }>(h, 'list_subscriptions')).subscriptions;
    expect(subs[0].feedUrl).toBe('https://feeds.example.com/private.xml?token=REDACTED&page=2');
    expect(subs[0].siteUrl).toBe('https://example.com/?key=REDACTED');
  });
});

describe('read tools', () => {
  async function seedAccount(h: Harness): Promise<void> {
    await push(h, {
      feeds: [
        { feedId: 'a', feedUrl: `${SITE}/a.xml`, htmlUrl: `${SITE}/`, title: 'Alpha', tags: ['tech'], deleted: 0 },
        { feedId: 'b', feedUrl: `${SITE}/b.xml`, title: 'Bravo', tags: ['news', 'tech'], deleted: 0 },
        { feedId: 'c', feedUrl: `${SITE}/c.xml`, title: 'Charlie', deleted: 0 },
        { feedId: 'gone', feedUrl: `${SITE}/gone.xml`, title: 'Gone', deleted: 1 },
      ],
    });
    await seedStats(h, 'a', 100, 80);
    await seedStats(h, 'b', 100, 10);
    await seedStats(h, 'c', 0, 0);
  }

  it('lists live subscriptions with tags and statistics, sorted and filtered', async () => {
    const h = await setup();
    await seedAccount(h);
    type Subs = { total: number; subscriptions: Array<{ feedId: string; tags: string[]; stats: { readIndex: number | null; backlog: number } }> };
    const byTitle = await data<Subs>(h, 'list_subscriptions');
    expect(byTitle.subscriptions.map((s) => s.feedId)).toEqual(['a', 'b', 'c']);
    expect(byTitle.subscriptions[0].tags).toEqual(['tech']);

    const engagement = await data<Subs>(h, 'list_subscriptions', { sort: 'engagement' });
    expect(engagement.subscriptions.map((s) => s.feedId)).toEqual(['a', 'b', 'c']);
    expect(engagement.subscriptions[0].stats.readIndex).toBeGreaterThan(engagement.subscriptions[1].stats.readIndex as number);
    expect(engagement.subscriptions[2].stats.readIndex).toBeNull();

    const backlog = await data<Subs>(h, 'list_subscriptions', { sort: 'backlog' });
    expect(backlog.subscriptions.map((s) => s.feedId)).toEqual(['b', 'a', 'c']);

    const tagged = await data<Subs>(h, 'list_subscriptions', { tag: 'News' });
    expect(tagged.subscriptions.map((s) => s.feedId)).toEqual(['b']);
  });

  it('matches siftctl stats output apart from URL redaction', async () => {
    const h = await setup();
    await seedAccount(h);
    const rows = (await h.sync.prepare('SELECT feed_id, feed_url, title, deleted FROM feeds WHERE sync_key = ? ORDER BY row_at ASC').bind(SYNC_KEY).all()).results;
    const stats = (await h.sync.prepare('SELECT feed_id, total_seen, read_once FROM feed_stats WHERE sync_key = ?').bind(SYNC_KEY).all()).results;
    const expected = buildStats(rows as never, stats);
    expect(await data(h, 'get_reading_stats')).toEqual(expected);
  });

  it('lists items newest first with filters and pagination', async () => {
    const h = await setup();
    await seedAccount(h);
    const now = Date.now();
    const day = 86_400_000;
    await seedItems(h, [
      { feedUrl: `${SITE}/a.xml`, guid: 'a1', title: 'Rust news', excerpt: 'about crabs', publishedAt: now - 1 * day },
      { feedUrl: `${SITE}/a.xml`, guid: 'a2', title: 'Old post', excerpt: 'dusty', publishedAt: now - 5 * day },
      { feedUrl: `${SITE}/b.xml`, guid: 'b1', title: 'Election', excerpt: 'votes', publishedAt: now - 2 * day },
      { feedUrl: `${SITE}/c.xml`, guid: 'c1', title: 'Undated', excerpt: 'no date', publishedAt: null, firstSeenAt: now - 3 * day },
      { feedUrl: `${SITE}/gone.xml`, guid: 'x1', title: 'Hidden', publishedAt: now },
    ]);
    type Items = { items: Array<{ id: string; feedId: string; title: string; read: boolean; starred: boolean }>; nextCursor: string | null };
    const all = await data<Items>(h, 'list_items');
    expect(all.items.map((i) => i.title)).toEqual(['Rust news', 'Election', 'Undated', 'Old post']);
    expect(all.items[0].id).toBe('a::a1');
    expect(all.nextCursor).toBeNull();

    expect((await data<Items>(h, 'list_items', { feedIds: ['b'] })).items.map((i) => i.title)).toEqual(['Election']);
    expect((await data<Items>(h, 'list_items', { tag: 'tech' })).items.map((i) => i.title)).toEqual(['Rust news', 'Election', 'Old post']);
    expect((await data<Items>(h, 'list_items', { since: new Date(now - 2.5 * day).toISOString() })).items.map((i) => i.title)).toEqual(['Rust news', 'Election']);
    expect((await data<Items>(h, 'list_items', { query: 'CRAB' })).items.map((i) => i.title)).toEqual(['Rust news']);

    await call(h, 'set_item_state', { itemIds: ['a::a1'], read: true });
    await call(h, 'set_item_state', { itemIds: ['b::b1'], starred: true });
    expect((await data<Items>(h, 'list_items', { unread: true })).items.map((i) => i.title)).toEqual(['Election', 'Undated', 'Old post']);
    expect((await data<Items>(h, 'list_items', { unread: false })).items.map((i) => i.title)).toEqual(['Rust news']);
    const starred = await data<Items>(h, 'list_items', { starred: true });
    expect(starred.items.map((i) => i.title)).toEqual(['Election']);
    expect(starred.items[0].starred).toBe(true);

    const first = await data<Items>(h, 'list_items', { limit: 2 });
    expect(first.items.map((i) => i.title)).toEqual(['Rust news', 'Election']);
    expect(first.nextCursor).not.toBeNull();
    const second = await data<Items>(h, 'list_items', { limit: 2, cursor: first.nextCursor as string });
    expect(second.items.map((i) => i.title)).toEqual(['Undated', 'Old post']);
    expect(second.nextCursor).toBeNull();
    expect((await call(h, 'list_items', { cursor: 'junk' })).isError).toBe(true);
  });

  it('converts items to Markdown and truncates at maxChars', async () => {
    const h = await setup();
    await seedAccount(h);
    const long = `<p>${'word '.repeat(400)}</p>`;
    await seedItems(h, [
      { feedUrl: `${SITE}/a.xml`, guid: 'rich', title: 'Rich', html: '<h2>Head</h2><p>Some <strong>bold</strong> and <em>it</em> with <a href="https://x.example/p">a link</a>.</p><ul><li>one</li><li>two</li></ul><script>evil()</script>', link: 'https://x.example/rich' },
      { feedUrl: `${SITE}/a.xml`, guid: 'long', title: 'Long', html: long },
      { feedUrl: `${SITE}/a.xml`, guid: 'plain', title: 'Plain', html: null, excerpt: 'Just an excerpt' },
    ]);
    type Item = { markdown: string; truncated: boolean; totalChars: number; hasFullContent: boolean; link: string | null; title: string };
    const rich = await data<Item>(h, 'get_item', { itemId: 'a::rich' });
    expect(rich.markdown).toBe('## Head\n\nSome **bold** and _it_ with [a link](https://x.example/p).\n\n- one\n- two');
    expect(rich.truncated).toBe(false);
    expect(rich.link).toBe('https://x.example/rich');
    expect(rich.hasFullContent).toBe(true);

    const cut = await data<Item>(h, 'get_item', { itemId: 'a::long', maxChars: 500 });
    expect(cut.truncated).toBe(true);
    expect(cut.markdown).toHaveLength(500);
    expect(cut.totalChars).toBeGreaterThan(500);
    const whole = await data<Item>(h, 'get_item', { itemId: 'a::long' });
    expect(whole.truncated).toBe(false);
    expect(whole.markdown).toHaveLength(whole.totalChars);

    const plain = await data<Item>(h, 'get_item', { itemId: 'a::plain' });
    expect(plain.markdown).toBe('Just an excerpt');
    expect(plain.hasFullContent).toBe(false);

    expect((await call(h, 'get_item', { itemId: 'a::missing' })).isError).toBe(true);
    expect((await call(h, 'get_item', { itemId: 'gone::x1' })).isError).toBe(true);
    expect((await call(h, 'get_item', { itemId: 'nonsense' })).isError).toBe(true);
  });
});

describe('Markdown conversion', () => {
  it('handles headings, emphasis, code, quotes, lists and entities without a DOM', () => {
    expect(htmlToMarkdown('<h1>Title</h1><p>A &amp; B&nbsp;&#169; <code>x &lt; y</code></p>')).toBe('# Title\n\nA & B © `x < y`');
    expect(htmlToMarkdown('<pre><code>line1\nline2</code></pre>')).toBe('```\nline1\nline2\n```');
    expect(htmlToMarkdown('<blockquote><p>quoted</p></blockquote><p>after</p>')).toBe('> quoted\n\nafter');
    expect(htmlToMarkdown('<ol><li>a</li><li>b<ul><li>c</li></ul></li></ol>')).toBe('1. a\n2. b\n  - c');
    expect(htmlToMarkdown('<p>one<br>two</p><style>p{}</style><!-- hidden -->')).toBe('one\ntwo');
    expect(htmlToMarkdown('<a href="javascript:alert(1)">bad</a>')).toBe('bad');
  });
});

describe('schema validation helper', () => {
  it('reports type, required, enum and bound violations', () => {
    const schema: Schema = {
      type: 'object',
      required: ['a'],
      additionalProperties: false,
      properties: { a: { type: 'integer', minimum: 1 }, b: { type: ['string', 'null'], enum: ['x', null] } },
    };
    expect(validateSchema(schema, { a: 1, b: null })).toEqual([]);
    expect(validateSchema(schema, {})).toEqual(['$.a is required']);
    expect(validateSchema(schema, { a: 0, b: 'y', c: 1 })).toHaveLength(3);
    expect(validateSchema(schema, { a: 1.5 })).toEqual(['$.a must be integer']);
  });
});

describe('write tools', () => {
  const FEED = `${SITE}/feed.xml`;

  it('subscribes idempotently and normalises tags', async () => {
    const h = await setup();
    stubUpstream({ [FEED]: { body: rss('My Blog', [{ title: 'One' }]) } });
    type Sub = { created: boolean; subscription: { feedId: string; title: string; siteUrl: string | null; feedUrl: string; tags: string[] } };
    const first = await data<Sub>(h, 'subscribe', { url: FEED, tags: [' Tech ', 'tech', 'Deep  Dives'] });
    expect(first.created).toBe(true);
    expect(first.subscription.title).toBe('My Blog');
    expect(first.subscription.tags).toEqual(['tech', 'deep dives']);
    expect(first.subscription.feedUrl).toBe(FEED);
    expect(first.subscription.feedId).toMatch(/^[0-9a-f-]{36}$/);

    const second = await data<Sub>(h, 'subscribe', { url: FEED, title: 'Changed', tags: ['other'] });
    expect(second.created).toBe(false);
    expect(second.subscription).toEqual(first.subscription);
    const rows = await h.sync.prepare('SELECT COUNT(*) AS n FROM feeds WHERE sync_key = ?').bind(SYNC_KEY).first<{ n: number }>();
    expect(rows?.n).toBe(1);

    expect((await call(h, 'subscribe', { url: FEED, tags: ['all'] })).isError).toBe(true);
    expect((await call(h, 'subscribe', { url: 'ftp://x.example/feed' })).isError).toBe(true);
  });

  it('honours a supplied title and registers the feed for polling', async () => {
    const h = await setup();
    stubUpstream({ [FEED]: { body: rss('My Blog', [{ title: 'One' }]) } });
    const sub = await data<{ subscription: { title: string } }>(h, 'subscribe', { url: FEED, title: 'Mine' });
    expect(sub.subscription.title).toBe('Mine');
    const polled = await h.poll.prepare('SELECT feed_url FROM polled_feeds').all<{ feed_url: string }>();
    expect(polled.results.map((r) => r.feed_url)).toEqual([FEED]);
  });

  it('fails to subscribe when no feed exists', async () => {
    vi.useFakeTimers();
    const h = await setup();
    stubUpstream({ [`${SITE}/blog`]: { body: '<html><body>nothing</body></html>', type: 'text/html' } });
    const result = await withTimers(call(h, 'subscribe', { url: `${SITE}/blog` }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No feed found/);
  });

  it('discovers the feed from a page when subscribing', async () => {
    vi.useFakeTimers();
    const h = await setup();
    stubUpstream({
      [`${SITE}/blog`]: { body: `<html><head><link rel="alternate" type="application/rss+xml" href="/posts.rss"></head></html>`, type: 'text/html' },
      [`${SITE}/posts.rss`]: { body: rss('Posts', [{ title: 'P' }]) },
    });
    const sub = await withTimers(data<{ created: boolean; subscription: { feedUrl: string } }>(h, 'subscribe', { url: `${SITE}/blog` }));
    expect(sub.created).toBe(true);
    expect(sub.subscription.feedUrl).toBe(`${SITE}/posts.rss`);
  });

  it('updates titles and tags, and rejects empty or unknown updates', async () => {
    const h = await setup();
    await push(h, { feeds: [{ feedId: 'f1', feedUrl: FEED, title: 'Old', tags: ['x'], deleted: 0 }] });
    type Sub = { subscription: { title: string; tags: string[] } };
    expect((await data<Sub>(h, 'update_subscription', { feedId: 'f1', title: 'New' })).subscription).toMatchObject({ title: 'New', tags: ['x'] });
    expect((await data<Sub>(h, 'update_subscription', { feedId: 'f1', tags: ['B', 'a'] })).subscription).toMatchObject({ title: 'New', tags: ['b', 'a'] });
    expect((await data<Sub>(h, 'update_subscription', { feedId: 'f1', tags: [] })).subscription.tags).toEqual([]);
    const again = await data<Sub>(h, 'update_subscription', { feedId: 'f1', title: 'New' });
    expect(again.subscription.title).toBe('New');
    expect((await call(h, 'update_subscription', { feedId: 'f1' })).isError).toBe(true);
    expect((await call(h, 'update_subscription', { feedId: 'zzz', title: 'x' })).isError).toBe(true);
  });

  it('unsubscribes idempotently and a later subscribe revives the same feed', async () => {
    const h = await setup();
    stubUpstream({ [FEED]: { body: rss('My Blog', [{ title: 'One' }]) } });
    const created = await data<{ subscription: { feedId: string } }>(h, 'subscribe', { url: FEED });
    const feedId = created.subscription.feedId;
    expect(await data(h, 'unsubscribe', { feedId })).toEqual({ feedId, removed: true });
    expect(await data(h, 'unsubscribe', { feedId })).toEqual({ feedId, removed: false });
    expect(await data(h, 'unsubscribe', { feedId: 'never-existed' })).toEqual({ feedId: 'never-existed', removed: false });
    expect((await data<{ total: number }>(h, 'list_subscriptions')).total).toBe(0);
    const revived = await data<{ created: boolean; subscription: { feedId: string } }>(h, 'subscribe', { url: FEED });
    expect(revived.created).toBe(true);
    expect(revived.subscription.feedId).toBe(feedId);
  });

  it('sets read and starred state for up to 100 items', async () => {
    const h = await setup();
    await push(h, { feeds: [{ feedId: 'f1', feedUrl: FEED, title: 'One', deleted: 0 }] });
    const ids = ['f1::g1', 'f1::g2'];
    expect(await data(h, 'set_item_state', { itemIds: ids, read: true, starred: true })).toEqual({ updated: 2 });
    expect(await data(h, 'set_item_state', { itemIds: ids, read: true, starred: true })).toEqual({ updated: 2 });
    const flags = await h.sync.prepare('SELECT item_id, read, starred FROM flags WHERE sync_key = ? ORDER BY item_id').bind(SYNC_KEY).all();
    expect(flags.results).toEqual([
      { item_id: 'f1::g1', read: 1, starred: 1 },
      { item_id: 'f1::g2', read: 1, starred: 1 },
    ]);
    await data(h, 'set_item_state', { itemIds: ['f1::g1'], read: false });
    const one = await h.sync.prepare('SELECT read, starred FROM flags WHERE item_id = ?').bind('f1::g1').first();
    expect(one).toEqual({ read: 0, starred: 1 });
    expect((await call(h, 'set_item_state', { itemIds: ['f1::g1'] })).isError).toBe(true);
    expect((await call(h, 'set_item_state', { itemIds: ['other::g1'], read: true })).isError).toBe(true);
    const tooMany = Array.from({ length: 101 }, (_, i) => `f1::g${i}`);
    expect((await call(h, 'set_item_state', { itemIds: tooMany, read: true })).isError).toBe(true);
  });

  it('applies an MCP subscribe so that a device pull sees it', async () => {
    const h = await setup();
    stubUpstream({ [FEED]: { body: rss('My Blog', [{ title: 'One' }]) } });
    const { subscription } = await data<{ subscription: { feedId: string } }>(h, 'subscribe', { url: FEED, tags: ['tech'] });
    await data(h, 'set_item_state', { itemIds: [`${subscription.feedId}::g1`], starred: true });

    const pull = await h.app.request('/sync/pull?since=0', { headers: { 'X-Sync-Key': SYNC_KEY } });
    expect(pull.status).toBe(200);
    const body = (await pull.json()) as {
      feeds: Array<{ feed_id: string; feed_url: string; title: string; tags: string; deleted: number }>;
      flags: Array<{ item_id: string; starred: number }>;
    };
    const feed = body.feeds.find((f) => f.feed_id === subscription.feedId);
    expect(feed).toMatchObject({ feed_url: FEED, title: 'My Blog', deleted: 0 });
    expect(JSON.parse(feed?.tags ?? '[]')).toEqual(['tech']);
    expect(body.flags).toContainEqual(expect.objectContaining({ item_id: `${subscription.feedId}::g1`, starred: 1 }));
  });
});

describe('discover_feeds', () => {
  type Found = { candidates: Array<{ feedUrl: string; title: string; siteUrl: string | null; itemCount: number; newestDate: string | null; sampleTitles: string[]; alreadySubscribed: boolean }> };

  it('parses a direct feed URL and reports samples, dates and subscription state', async () => {
    const h = await setup();
    await push(h, { feeds: [{ feedId: 'f1', feedUrl: `${SITE}/feed.xml`, title: 'Mine', deleted: 0 }] });
    const requested = stubUpstream({
      [`${SITE}/feed.xml`]: {
        body: rss('My Blog', [
          { title: 'Newest', date: 'Mon, 05 Jan 2026 10:00:00 GMT' },
          { title: 'Two', date: 'Sun, 04 Jan 2026 10:00:00 GMT' },
          { title: 'Three' },
          { title: 'Four' },
        ]),
      },
    });
    const found = await data<Found>(h, 'discover_feeds', { url: `${SITE}/feed.xml` });
    expect(requested).toEqual([`${SITE}/feed.xml`]);
    expect(found.candidates).toHaveLength(1);
    expect(found.candidates[0]).toMatchObject({
      feedUrl: `${SITE}/feed.xml`,
      title: 'My Blog',
      siteUrl: `${SITE}/`,
      itemCount: 4,
      newestDate: '2026-01-05T10:00:00.000Z',
      sampleTitles: ['Newest', 'Two', 'Three'],
      alreadySubscribed: true,
    });
  });

  it('follows alternate links advertised by a page', async () => {
    vi.useFakeTimers();
    const h = await setup();
    const requested = stubUpstream({
      [`${SITE}/`]: {
        body: `<html><head>
          <link rel="alternate" type="application/rss+xml" href="/rss">
          <link rel="alternate" type="application/atom+xml" href="https://elsewhere.example/atom">
          </head></html>`,
        type: 'text/html',
      },
      [`${SITE}/rss`]: { body: rss('Via Link', [{ title: 'A' }]) },
    });
    const found = await withTimers(data<Found>(h, 'discover_feeds', { url: `${SITE}/` }));
    expect(found.candidates.map((c) => c.feedUrl)).toEqual([`${SITE}/rss`]);
    expect(found.candidates[0].alreadySubscribed).toBe(false);
    expect(requested).not.toContain(`${SITE}/feed`);
  });

  it('probes conventional paths in order and stops at the first feed', async () => {
    vi.useFakeTimers();
    const h = await setup();
    const requested = stubUpstream({
      [`${SITE}/about`]: { body: '<html><body>about</body></html>', type: 'text/html' },
      [`${SITE}/atom.xml`]: { body: rss('Atom Path', [{ title: 'A' }]) },
      [`${SITE}/index.xml`]: { body: rss('Never Reached', [{ title: 'B' }]) },
    });
    const found = await withTimers(data<Found>(h, 'discover_feeds', { url: `${SITE}/about` }));
    expect(found.candidates.map((c) => c.feedUrl)).toEqual([`${SITE}/atom.xml`]);
    expect(requested).toEqual([`${SITE}/about`, `${SITE}/feed`, `${SITE}/rss.xml`, `${SITE}/atom.xml`]);
  });

  it('accepts a bare host name', async () => {
    const h = await setup();
    stubUpstream({ 'https://93.184.216.34/feed.xml': { body: rss('Bare', [{ title: 'A' }]) } });
    const found = await data<Found>(h, 'discover_feeds', { url: '93.184.216.34/feed.xml' });
    expect(found.candidates[0].title).toBe('Bare');
  });

  it('returns no candidates when nothing is found', async () => {
    vi.useFakeTimers();
    const h = await setup();
    const requested = stubUpstream({ [`${SITE}/`]: { body: '<html></html>', type: 'text/html' } });
    const result = await withTimers(call(h, 'discover_feeds', { url: SITE }));
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ candidates: [] });
    expect(requested).toEqual([`${SITE}/`, `${SITE}/feed`, `${SITE}/rss.xml`, `${SITE}/atom.xml`, `${SITE}/index.xml`, `${SITE}/feed.xml`]);
  });

  it('rejects non-HTTP URLs and unreachable targets', async () => {
    const h = await setup();
    stubUpstream({});
    expect((await call(h, 'discover_feeds', { url: 'file:///etc/passwd' })).isError).toBe(true);
    const blocked = await call(h, 'discover_feeds', { url: 'http://127.0.0.1/feed' });
    expect(blocked.isError).toBe(true);
  });

  it('limits discovery per sync key with a retry interval', async () => {
    const h = await setup();
    const windowStart = Math.floor(Date.now() / 1000 / RATE_LIMITS.discover.windowSeconds) * RATE_LIMITS.discover.windowSeconds;
    await h.sync
      .prepare('INSERT INTO rate_limits (scope, window_start, count) VALUES (?, ?, ?)')
      .bind(`discover:${SYNC_KEY}`, windowStart, RATE_LIMITS.discover.limit)
      .run();
    const requested = stubUpstream({});
    const result = await call(h, 'discover_feeds', { url: `${SITE}/feed.xml` });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Retry in \d+ seconds/);
    expect(requested).toEqual([]);
  });
});

describe('rate limits', () => {
  it('limits each token separately and tells the agent when to retry', async () => {
    const h = await setup();
    const other = await addToken(h.sync, 'read write');
    const windowStart = Math.floor(Date.now() / 1000 / RATE_LIMITS.mcp.windowSeconds) * RATE_LIMITS.mcp.windowSeconds;
    await h.sync
      .prepare('INSERT INTO rate_limits (scope, window_start, count) VALUES (?, ?, ?)')
      .bind(`mcp:tok:${h.tokenId}`, windowStart, RATE_LIMITS.mcp.limit)
      .run();
    const limited = await call(h, 'list_subscriptions');
    expect(limited.isError).toBe(true);
    expect(limited.content[0].text).toMatch(/Retry in \d+ seconds/);
    const res = await rpc(h, 'tools/call', { name: 'list_subscriptions', arguments: {} }, '/mcp', other.token);
    expect((res.result as unknown as ToolResponse).isError).toBeFalsy();
    const pull = await h.app.request('/sync/pull?since=0', { headers: { 'X-Sync-Key': SYNC_KEY } });
    expect(pull.status).toBe(200);
    expect((await rpc(h, 'ping')).result).toEqual({});
  });
});

describe('output schema conformance', () => {
  it('every tool returns structured content matching its declared output schema', async () => {
    vi.useFakeTimers();
    const h = await setup();
    const tools = new Map((await listTools(h)).map((tool) => [tool.name, tool]));
    stubUpstream({
      [`${SITE}/feed.xml`]: { body: rss('My Blog', [{ title: 'One', date: 'Mon, 05 Jan 2026 10:00:00 GMT' }]) },
    });
    await seedStats(h, 'f0', 10, 5);
    await push(h, { feeds: [{ feedId: 'f0', feedUrl: `${SITE}/old.xml`, title: 'Old', tags: ['t'], deleted: 0 }] });
    await seedItems(h, [{ feedUrl: `${SITE}/old.xml`, guid: 'g', title: 'Item', html: '<p>Hi</p>', link: `${SITE}/item` }]);

    const calls: Array<[string, Record<string, unknown>]> = [
      ['list_subscriptions', {}],
      ['list_subscriptions', { sort: 'engagement', tag: 't' }],
      ['get_reading_stats', {}],
      ['list_items', {}],
      ['list_items', { limit: 1 }],
      ['get_item', { itemId: 'f0::g' }],
      ['discover_feeds', { url: `${SITE}/feed.xml` }],
      ['discover_feeds', { url: `${SITE}/nothing` }],
      ['subscribe', { url: `${SITE}/feed.xml`, tags: ['x'] }],
      ['subscribe', { url: `${SITE}/feed.xml` }],
      ['update_subscription', { feedId: 'f0', title: 'Renamed' }],
      ['set_item_state', { itemIds: ['f0::g'], read: true }],
      ['unsubscribe', { feedId: 'f0' }],
      ['unsubscribe', { feedId: 'f0' }],
    ];
    const seen = new Set<string>();
    for (const [name, args] of calls) {
      const result = await withTimers(call(h, name, args));
      expect(result.isError, `${name}: ${result.content[0]?.text}`).toBeFalsy();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text.length).toBeGreaterThan(0);
      const tool = tools.get(name) as ListedTool;
      expect(validateSchema(tool.outputSchema, result.structuredContent), name).toEqual([]);
      seen.add(name);
    }
    expect([...seen].sort()).toEqual([...tools.keys()].sort());
  });
});
