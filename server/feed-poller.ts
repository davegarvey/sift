/**
 * Server-side feed polling for synced accounts (opt-in via FEED_POLLING and
 * a POLL_DB binding).
 *
 * The poll database holds a registry of feed URLs to poll (`polled_feeds`)
 * and the entries found (`polled_items`), keyed by URL and never by sync
 * key. Subscribing adds a URL to the registry; a daily maintenance pass
 * rebuilds it from the live subscriptions of active accounts (capped per
 * account) and deletes expired entries. Each run polls a bounded batch of
 * due URLs through the same cache, cooldowns and origin governor as
 * `/feed`, one host at a time per lane. Devices pull entries via
 * /sync/items.
 */

import { fetchFeedCached, validateUpstreamUrl } from './fetch';
import { parseFeed, type ParsedItem } from '../src/feeds/parse';
import { MAX_POLLED_FEEDS_PER_ACCOUNT, URL_CHUNK_SIZE, chunk, registerStatement } from './poll-registry';

export const POLL_INTERVAL_MS = 30 * 60_000;
export const POLL_RETRY_MAX_MS = 24 * 60 * 60_000;
export const POLL_DEFER_MIN_MS = 60_000;
export const ACTIVE_ACCOUNT_WINDOW_SECONDS = 14 * 24 * 60 * 60;
export const DEFAULT_POLL_BATCH = 50;
export const POLL_CONCURRENCY = 4;
export const MAX_ITEMS_PER_POLL = 100;
export const MAX_ITEM_HTML_BYTES = 64 * 1024;
export const ITEM_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const MAX_INSERT_CHUNK_BYTES = 1_000_000;
export const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60_000;
export const DEFAULT_MAX_POLL_DB_BYTES = 8 * 1024 ** 3;

const ACCOUNT_PAGE_SIZE = 500;
const REGISTRY_PAGE_SIZE = 5_000;
const EXPIRY_DELETE_CHUNK = 10_000;
const MAX_EXPIRY_DELETES = 50;
const LOCAL_REQUEST_SOURCES = new Set(['local-gate', 'origin-cooldown', 'url-cooldown']);

interface DueFeed {
  feed_url: string;
  etag: string | null;
  last_modified: string | null;
  failures: number;
}

type PollOutcome = 'updated' | 'unchanged' | 'deferred' | 'failed';

export interface PollSummary {
  due: number;
  updated: number;
  unchanged: number;
  deferred: number;
  failed: number;
  inserted: number;
  maintenance: boolean;
  storageFull: boolean;
}

export interface PollOptions {
  batch?: number;
  maxDbBytes?: number;
  now?: () => number;
}

export interface MaintenanceSummary {
  registered: number;
  added: number;
  removed: number;
  expiredItems: number;
}

const encoder = new TextEncoder();

export function parsePositiveInt(raw: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

export function parsePollBatch(raw: string | undefined): number {
  return parsePositiveInt(raw, DEFAULT_POLL_BATCH, 500);
}

export function failureDelayMs(failures: number, retryAfterMs: number | undefined): number {
  const backoff = Math.min(POLL_INTERVAL_MS * 2 ** Math.max(0, failures - 1), POLL_RETRY_MAX_MS);
  return Math.min(Math.max(backoff, retryAfterMs ?? 0), POLL_RETRY_MAX_MS);
}

function retryAfterMs(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function storableHtml(html: string | undefined): string | null {
  if (!html) return null;
  return encoder.encode(html).byteLength <= MAX_ITEM_HTML_BYTES ? html : null;
}

export function chunkItemRows(items: ParsedItem[]): string[] {
  const chunks: string[] = [];
  let rows: string[] = [];
  let bytes = 0;
  for (const item of items) {
    const row = JSON.stringify({
      guid: item.guid,
      title: item.title,
      link: item.link ?? null,
      author: item.author ?? null,
      published_at: item.publishedAt,
      excerpt: item.excerpt,
      html: storableHtml(item.html),
      thumbnail: item.thumbnail ?? null,
    });
    const size = encoder.encode(row).byteLength;
    if (rows.length > 0 && bytes + size > MAX_INSERT_CHUNK_BYTES) {
      chunks.push(`[${rows.join(',')}]`);
      rows = [];
      bytes = 0;
    }
    rows.push(row);
    bytes += size;
  }
  if (rows.length > 0) chunks.push(`[${rows.join(',')}]`);
  return chunks;
}

function scheduleStatement(
  pollDb: D1Database,
  feedUrl: string,
  fields: { etag: string | null; lastModified: string | null; nextPollAt: number; failures: number; status: number },
  now: number,
): D1PreparedStatement {
  return pollDb
    .prepare(
      `UPDATE polled_feeds
       SET etag = ?, last_modified = ?, next_poll_at = ?, failures = ?, last_status = ?, updated_at = ?
       WHERE feed_url = ?`,
    )
    .bind(fields.etag, fields.lastModified, fields.nextPollAt, fields.failures, fields.status, now, feedUrl);
}

function insertItemsStatement(pollDb: D1Database, feedUrl: string, rows: string, now: number): D1PreparedStatement {
  return pollDb
    .prepare(
      `INSERT OR IGNORE INTO polled_items
         (feed_url, guid, title, link, author, published_at, excerpt, html, thumbnail, first_seen_at)
       SELECT ?, json_extract(value, '$.guid'), json_extract(value, '$.title'), json_extract(value, '$.link'),
              json_extract(value, '$.author'), json_extract(value, '$.published_at'), json_extract(value, '$.excerpt'),
              json_extract(value, '$.html'), json_extract(value, '$.thumbnail'), ?
       FROM json_each(?)
       ORDER BY key`,
    )
    .bind(feedUrl, now, rows);
}

async function recordFailure(pollDb: D1Database, feed: DueFeed, status: number, retryMs: number | undefined, now: number): Promise<void> {
  const failures = feed.failures + 1;
  await scheduleStatement(pollDb, feed.feed_url, {
    etag: feed.etag,
    lastModified: feed.last_modified,
    nextPollAt: now + failureDelayMs(failures, retryMs),
    failures,
    status,
  }, now).run();
}

async function pollFeed(syncDb: D1Database, pollDb: D1Database, feed: DueFeed, now: number): Promise<{ outcome: PollOutcome; inserted: number }> {
  const upstream = await validateUpstreamUrl(feed.feed_url);
  if (!upstream) {
    await recordFailure(pollDb, feed, 400, POLL_RETRY_MAX_MS, now);
    return { outcome: 'failed', inserted: 0 };
  }

  let response: Response;
  try {
    response = (await fetchFeedCached(upstream, {
      etag: feed.etag ?? undefined,
      lastModified: feed.last_modified ?? undefined,
    }, syncDb)).response;
  } catch {
    await recordFailure(pollDb, feed, 502, undefined, now);
    return { outcome: 'failed', inserted: 0 };
  }

  if (response.status === 304) {
    const wait = retryAfterMs(response.headers, 'X-Sift-Retry-After') ?? 0;
    await scheduleStatement(pollDb, feed.feed_url, {
      etag: feed.etag,
      lastModified: feed.last_modified,
      nextPollAt: now + Math.max(POLL_INTERVAL_MS, wait),
      failures: 0,
      status: 304,
    }, now).run();
    return { outcome: 'unchanged', inserted: 0 };
  }

  if (response.status !== 200) {
    await response.body?.cancel();
    const retryMs = retryAfterMs(response.headers, 'Retry-After');
    if (LOCAL_REQUEST_SOURCES.has(response.headers.get('X-Sift-Request-Source') ?? '')) {
      await scheduleStatement(pollDb, feed.feed_url, {
        etag: feed.etag,
        lastModified: feed.last_modified,
        nextPollAt: now + Math.min(Math.max(retryMs ?? 0, POLL_DEFER_MIN_MS), POLL_RETRY_MAX_MS),
        failures: feed.failures,
        status: response.status,
      }, now).run();
      return { outcome: 'deferred', inserted: 0 };
    }
    await recordFailure(pollDb, feed, response.status, retryMs, now);
    return { outcome: 'failed', inserted: 0 };
  }

  const parsed = parseFeed(await response.text(), upstream);
  if (!parsed) {
    await recordFailure(pollDb, feed, 200, undefined, now);
    return { outcome: 'failed', inserted: 0 };
  }

  const chunks = chunkItemRows(parsed.items.slice(0, MAX_ITEMS_PER_POLL));
  const wait = retryAfterMs(response.headers, 'X-Sift-Retry-After') ?? 0;
  const results = await pollDb.batch([
    ...chunks.map((rows) => insertItemsStatement(pollDb, feed.feed_url, rows, now)),
    scheduleStatement(pollDb, feed.feed_url, {
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
      nextPollAt: now + Math.max(POLL_INTERVAL_MS, wait),
      failures: 0,
      status: 200,
    }, now),
  ]);
  const inserted = results
    .slice(0, chunks.length)
    .reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0);
  return { outcome: 'updated', inserted };
}

export function hostLanes<T extends { feed_url: string }>(feeds: T[]): T[][] {
  const lanes = new Map<string, T[]>();
  for (const feed of feeds) {
    let host = feed.feed_url;
    try {
      host = new URL(feed.feed_url).host;
    } catch {
      // Unparseable URLs get a lane of their own and fail validation.
    }
    const lane = lanes.get(host) ?? [];
    lane.push(feed);
    lanes.set(host, lane);
  }
  return [...lanes.values()];
}

async function runLanes<R>(lanes: DueFeed[][], fn: (feed: DueFeed) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, lanes.length) }, async () => {
    while (next < lanes.length) {
      const lane = lanes[next++];
      for (const feed of lane) results.push(await fn(feed));
    }
  });
  await Promise.all(workers);
  return results;
}

async function maintenanceDue(pollDb: D1Database, now: number): Promise<boolean> {
  const row = await pollDb
    .prepare("SELECT value FROM poll_meta WHERE key = 'maintained_at'")
    .first<{ value: number }>();
  return !row || now - row.value >= MAINTENANCE_INTERVAL_MS;
}

async function collectPolledUrls(syncDb: D1Database, now: number): Promise<Set<string>> {
  const activeSince = Math.floor(now / 1000) - ACTIVE_ACCOUNT_WINDOW_SECONDS;
  const urls = new Set<string>();
  let after = '';
  for (;;) {
    const accounts = await syncDb
      .prepare(
        `SELECT sync_key FROM users
         WHERE sync_key > ? AND rotated_at IS NULL AND last_active_at >= ?
         ORDER BY sync_key LIMIT ?`,
      )
      .bind(after, activeSince, ACCOUNT_PAGE_SIZE)
      .all<{ sync_key: string }>();
    const keys = accounts.results.map((row) => row.sync_key);
    if (keys.length === 0) break;
    const feeds = await syncDb
      .prepare(
        `SELECT DISTINCT feed_url FROM (
           SELECT feed_url, ROW_NUMBER() OVER (PARTITION BY sync_key ORDER BY feed_id) AS rank
           FROM feeds
           WHERE sync_key IN (SELECT value FROM json_each(?)) AND deleted = 0 AND feed_url IS NOT NULL AND feed_url != ''
         ) WHERE rank <= ?`,
      )
      .bind(JSON.stringify(keys), MAX_POLLED_FEEDS_PER_ACCOUNT)
      .all<{ feed_url: string }>();
    for (const row of feeds.results) urls.add(row.feed_url);
    if (keys.length < ACCOUNT_PAGE_SIZE) break;
    after = keys[keys.length - 1];
  }
  return urls;
}

async function listRegisteredUrls(pollDb: D1Database): Promise<Set<string>> {
  const urls = new Set<string>();
  let after = '';
  for (;;) {
    const page = await pollDb
      .prepare('SELECT feed_url FROM polled_feeds WHERE feed_url > ? ORDER BY feed_url LIMIT ?')
      .bind(after, REGISTRY_PAGE_SIZE)
      .all<{ feed_url: string }>();
    for (const row of page.results) urls.add(row.feed_url);
    if (page.results.length < REGISTRY_PAGE_SIZE) break;
    after = page.results[page.results.length - 1].feed_url;
  }
  return urls;
}

export async function runPollMaintenance(syncDb: D1Database, pollDb: D1Database, now = Date.now()): Promise<MaintenanceSummary> {
  const [wanted, registered] = await Promise.all([collectPolledUrls(syncDb, now), listRegisteredUrls(pollDb)]);
  const added = [...wanted].filter((url) => !registered.has(url));
  const removed = [...registered].filter((url) => !wanted.has(url));
  const statements = [
    ...chunk(added, URL_CHUNK_SIZE).map((urls) => registerStatement(pollDb, urls, now)),
    ...chunk(removed, URL_CHUNK_SIZE).map((urls) =>
      pollDb.prepare('DELETE FROM polled_feeds WHERE feed_url IN (SELECT value FROM json_each(?))').bind(JSON.stringify(urls))),
  ];
  if (statements.length > 0) await pollDb.batch(statements);

  let expiredItems = 0;
  for (let round = 0; round < MAX_EXPIRY_DELETES; round++) {
    const result = await pollDb
      .prepare('DELETE FROM polled_items WHERE seq IN (SELECT seq FROM polled_items WHERE first_seen_at < ? LIMIT ?)')
      .bind(now - ITEM_RETENTION_MS, EXPIRY_DELETE_CHUNK)
      .run();
    const changes = result.meta?.changes ?? 0;
    expiredItems += changes;
    if (changes < EXPIRY_DELETE_CHUNK) break;
  }

  await pollDb
    .prepare(
      `INSERT INTO poll_meta (key, value) VALUES ('maintained_at', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .bind(now)
    .run();
  return { registered: wanted.size, added: added.length, removed: removed.length, expiredItems };
}

export async function pollFeeds(syncDb: D1Database, pollDb: D1Database, options: PollOptions = {}): Promise<PollSummary> {
  const now = options.now ?? Date.now;
  const summary: PollSummary = {
    due: 0, updated: 0, unchanged: 0, deferred: 0, failed: 0, inserted: 0, maintenance: false, storageFull: false,
  };

  if (await maintenanceDue(pollDb, now())) {
    const maintenance = await runPollMaintenance(syncDb, pollDb, now());
    summary.maintenance = true;
    console.info(JSON.stringify({ event: 'feed_poll.maintenance', ...maintenance }));
    return summary;
  }

  const startedAt = now();
  const due = await pollDb
    .prepare(
      `SELECT feed_url, etag, last_modified, failures FROM polled_feeds
       WHERE next_poll_at <= ? ORDER BY next_poll_at ASC LIMIT ?`,
    )
    .bind(startedAt, options.batch ?? DEFAULT_POLL_BATCH)
    .all<DueFeed>();
  const sizeBytes = due.meta?.size_after ?? 0;
  if (sizeBytes > (options.maxDbBytes ?? DEFAULT_MAX_POLL_DB_BYTES)) {
    summary.storageFull = true;
    console.warn(JSON.stringify({ event: 'feed_poll.storage_full', sizeBytes }));
    return summary;
  }

  const feeds = due.results;
  summary.due = feeds.length;
  if (feeds.length === 0) return summary;
  await pollDb
    .prepare(
      `UPDATE polled_feeds SET next_poll_at = ?, updated_at = ?
       WHERE feed_url IN (SELECT value FROM json_each(?))`,
    )
    .bind(startedAt + POLL_INTERVAL_MS, startedAt, JSON.stringify(feeds.map((feed) => feed.feed_url)))
    .run();

  const results = await runLanes(hostLanes(feeds), async (feed) => {
    try {
      return await pollFeed(syncDb, pollDb, feed, now());
    } catch {
      return { outcome: 'failed' as const, inserted: 0 };
    }
  }, POLL_CONCURRENCY);
  for (const result of results) {
    summary[result.outcome] += 1;
    summary.inserted += result.inserted;
  }
  console.info(JSON.stringify({ event: 'feed_poll.run', ...summary }));
  return summary;
}
