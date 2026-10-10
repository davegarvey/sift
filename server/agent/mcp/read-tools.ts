import { buildStats, type FeedStatsView } from '../../../packages/siftctl/src/stats';
import { decodeItemId, encodeItemId } from '../../../src/sync/itemId';
import { htmlToMarkdown } from './markdown';
import { isoDate, liveFeeds, loadFeedRows, loadLiveFeeds, type LiveFeed } from './data';
import { redactNullable, redactUrl } from './redact';
import type { Schema } from './schema';
import { ToolError, type ToolContext, type ToolDefinition } from './types';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const nullableNumber: Schema = { type: ['number', 'null'] };
const nullableString: Schema = { type: ['string', 'null'] };

const feedStatsSchema: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['feedId', 'title', 'url', 'totalSeen', 'readOnce', 'readRate', 'expectedReads', 'readIndex', 'backlog'],
  properties: {
    feedId: { type: 'string' },
    title: { type: 'string' },
    url: { type: 'string' },
    totalSeen: { type: 'integer' },
    readOnce: { type: 'integer' },
    readRate: nullableNumber,
    expectedReads: nullableNumber,
    readIndex: nullableNumber,
    backlog: { type: 'integer' },
  },
};

async function loadStats(ctx: ToolContext) {
  const [rows, statsRes] = await Promise.all([
    loadFeedRows(ctx.db, ctx.syncKey),
    ctx.db
      .prepare('SELECT feed_id, total_seen, read_once FROM feed_stats WHERE sync_key = ?')
      .bind(ctx.syncKey)
      .all(),
  ]);
  return { rows, stats: buildStats(rows, statsRes.results) };
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`;
}

function index(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

function compareEngagement(a: FeedStatsView, b: FeedStatsView): number {
  if (a.readIndex !== b.readIndex) {
    if (a.readIndex === null) return 1;
    if (b.readIndex === null) return -1;
    return b.readIndex - a.readIndex;
  }
  if (a.readOnce !== b.readOnce) return b.readOnce - a.readOnce;
  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

const listSubscriptions: ToolDefinition = {
  name: 'list_subscriptions',
  title: 'List subscriptions',
  description:
    'List the feeds the user is subscribed to, with tags and reading statistics. Sort by "engagement" (read index, highest first, feeds without enough data last), "title" or "backlog" (most unread first).',
  scope: 'read',
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      sort: { type: 'string', enum: ['engagement', 'title', 'backlog'], description: 'Sort order. Defaults to title.' },
      tag: { type: 'string', description: 'Only feeds carrying this tag.' },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['total', 'subscriptions'],
    properties: {
      total: { type: 'integer' },
      subscriptions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['feedId', 'title', 'siteUrl', 'feedUrl', 'tags', 'stats'],
          properties: {
            feedId: { type: 'string' },
            title: { type: 'string' },
            siteUrl: nullableString,
            feedUrl: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            stats: {
              type: 'object',
              additionalProperties: false,
              required: ['totalSeen', 'readOnce', 'readRate', 'readIndex', 'backlog'],
              properties: {
                totalSeen: { type: 'integer' },
                readOnce: { type: 'integer' },
                readRate: nullableNumber,
                readIndex: nullableNumber,
                backlog: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
  async run(ctx, args) {
    const sort = (args.sort as string | undefined) ?? 'title';
    const tag = typeof args.tag === 'string' ? args.tag.trim().replace(/\s+/g, ' ').toLowerCase() : undefined;
    const { rows, stats } = await loadStats(ctx);
    const feedsById = new Map(liveFeeds(rows).map((feed) => [feed.feedId, feed]));
    let views = stats.feeds.filter((view) => feedsById.has(view.feedId));
    if (tag) views = views.filter((view) => feedsById.get(view.feedId)?.tags.includes(tag));
    if (sort === 'engagement') views.sort(compareEngagement);
    else if (sort === 'backlog') {
      views.sort((a, b) => b.backlog - a.backlog || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    } else {
      views.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.feedId.localeCompare(b.feedId));
    }
    const subscriptions = views.map((view) => {
      const feed = feedsById.get(view.feedId) as LiveFeed;
      return {
        feedId: view.feedId,
        title: view.title,
        siteUrl: redactNullable(feed.siteUrl),
        feedUrl: redactUrl(feed.url),
        tags: feed.tags,
        stats: {
          totalSeen: view.totalSeen,
          readOnce: view.readOnce,
          readRate: view.readRate,
          readIndex: view.readIndex,
          backlog: view.backlog,
        },
      };
    });
    const lines = subscriptions.map(
      (s) =>
        `- ${s.title} [${s.feedId}] ${s.feedUrl}${s.tags.length ? ` tags: ${s.tags.join(', ')}` : ''} | seen ${s.stats.totalSeen}, read ${s.stats.readOnce}, read index ${index(s.stats.readIndex)}, backlog ${s.stats.backlog}`,
    );
    return {
      data: { total: subscriptions.length, subscriptions },
      text: [`${subscriptions.length} subscriptions (sorted by ${sort})`, ...lines].join('\n'),
    };
  },
};

const getReadingStats: ToolDefinition = {
  name: 'get_reading_stats',
  title: 'Get reading statistics',
  description:
    'Reading statistics for the account: overall seen and read counts, and per-feed read rate, read index (1.0 is average engagement) and unread backlog. Matches `siftctl stats --json`. Counts are approximate.',
  scope: 'read',
  annotations: READ_ONLY,
  inputSchema: { type: 'object', properties: {} },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'approximate', 'summary', 'feeds'],
    properties: {
      source: { type: 'string', enum: ['sync'] },
      approximate: { type: 'boolean' },
      summary: {
        type: 'object',
        additionalProperties: false,
        required: ['totalSeen', 'readOnce', 'readRate'],
        properties: { totalSeen: { type: 'integer' }, readOnce: { type: 'integer' }, readRate: nullableNumber },
      },
      feeds: { type: 'array', items: feedStatsSchema },
    },
  },
  async run(ctx) {
    const { stats } = await loadStats(ctx);
    const feeds = stats.feeds.map((feed) => ({ ...feed, url: redactUrl(feed.url) }));
    const lines = feeds.map(
      (f) => `- ${f.title} [${f.feedId}] seen ${f.totalSeen}, read ${f.readOnce}, rate ${percent(f.readRate)}, index ${index(f.readIndex)}, backlog ${f.backlog}`,
    );
    return {
      data: { ...stats, feeds },
      text: [
        `Seen ${stats.summary.totalSeen}, read ${stats.summary.readOnce}, read rate ${percent(stats.summary.readRate)} (approximate)`,
        ...lines,
      ].join('\n'),
    };
  },
};

const DEFAULT_LIMIT = 50;
const PAGE_ROWS = 200;
const MAX_SCAN_ROWS = 4000;
const CURSOR = /^(\d+)\.(\d+)$/;
const SORT_AT = 'COALESCE(published_at, first_seen_at)';

interface PolledRow {
  seq: number;
  feed_url: string;
  guid: string;
  title: string;
  link: string | null;
  author: string | null;
  published_at: number | null;
  first_seen_at: number;
  excerpt: string;
  sort_at: number;
}

interface FlagRow {
  item_id: string;
  read: number | null;
  starred: number | null;
}

async function loadFlags(ctx: ToolContext, itemIds: string[]): Promise<Map<string, FlagRow>> {
  const flags = new Map<string, FlagRow>();
  if (itemIds.length === 0) return flags;
  const res = await ctx.db
    .prepare('SELECT item_id, read, starred FROM flags WHERE sync_key = ? AND item_id IN (SELECT value FROM json_each(?))')
    .bind(ctx.syncKey, JSON.stringify(itemIds))
    .all<FlagRow>();
  for (const row of res.results) flags.set(row.item_id, row);
  return flags;
}

const listItems: ToolDefinition = {
  name: 'list_items',
  title: 'List recent items',
  description:
    'List recent articles from the user\'s subscriptions (the last seven days), newest first, with excerpt, read and starred state. Filter by feedIds, tag, since (ISO date), unread, starred and query (case-insensitive text match on title and excerpt). Pass the returned nextCursor to continue.',
  scope: 'read',
  needsPoll: true,
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    properties: {
      feedIds: { type: 'array', items: { type: 'string' }, maxItems: 100, description: 'Only these feeds.' },
      tag: { type: 'string', description: 'Only feeds carrying this tag.' },
      since: { type: 'string', description: 'ISO 8601 date or timestamp; only items published at or after it.' },
      unread: { type: 'boolean', description: 'true for unread items only, false for read items only.' },
      starred: { type: 'boolean', description: 'true for starred items only, false for unstarred only.' },
      query: { type: 'string', maxLength: 200, description: 'Case-insensitive substring of title or excerpt.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Items per page. Defaults to 50.' },
      cursor: { type: 'string', description: 'The nextCursor from a previous call.' },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'nextCursor'],
    properties: {
      nextCursor: nullableString,
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'feedId', 'feedTitle', 'title', 'link', 'author', 'publishedAt', 'excerpt', 'read', 'starred'],
          properties: {
            id: { type: 'string' },
            feedId: { type: 'string' },
            feedTitle: { type: 'string' },
            title: { type: 'string' },
            link: nullableString,
            author: nullableString,
            publishedAt: nullableString,
            excerpt: { type: 'string' },
            read: { type: 'boolean' },
            starred: { type: 'boolean' },
          },
        },
      },
    },
  },
  async run(ctx, args) {
    const pollDb = ctx.pollDb as D1Database;
    const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_LIMIT;
    const feedIds = Array.isArray(args.feedIds) ? (args.feedIds as string[]) : undefined;
    const tag = typeof args.tag === 'string' ? args.tag.trim().replace(/\s+/g, ' ').toLowerCase() : undefined;
    const query = typeof args.query === 'string' && args.query.trim() ? args.query.trim().toLowerCase() : undefined;
    const unread = typeof args.unread === 'boolean' ? args.unread : undefined;
    const starred = typeof args.starred === 'boolean' ? args.starred : undefined;

    let sinceMs: number | undefined;
    if (typeof args.since === 'string') {
      sinceMs = Date.parse(args.since);
      if (Number.isNaN(sinceMs)) throw new ToolError('since must be an ISO 8601 date or timestamp.');
    }
    let cursorAt: number | undefined;
    let cursorSeq = 0;
    if (typeof args.cursor === 'string') {
      const match = CURSOR.exec(args.cursor);
      if (!match) throw new ToolError('cursor is not valid. Use the nextCursor from a previous call.');
      cursorAt = Number(match[1]);
      cursorSeq = Number(match[2]);
    }

    let feeds = (await loadLiveFeeds(ctx)).slice(0, 500);
    if (feedIds) feeds = feeds.filter((feed) => feedIds.includes(feed.feedId));
    if (tag) feeds = feeds.filter((feed) => feed.tags.includes(tag));
    if (feeds.length === 0) return { data: { items: [], nextCursor: null }, text: 'No matching items.' };
    const feedByUrl = new Map(feeds.map((feed) => [feed.url, feed]));
    const urlsJson = JSON.stringify([...feedByUrl.keys()]);

    const items: Array<{
      id: string; feedId: string; feedTitle: string; title: string; link: string | null; author: string | null;
      publishedAt: string | null; excerpt: string; read: boolean; starred: boolean;
    }> = [];
    let position: { at: number; seq: number } | undefined = cursorAt === undefined ? undefined : { at: cursorAt, seq: cursorSeq };
    let scanned = 0;
    let hasMore = false;

    scan: while (true) {
      const clauses = ['feed_url IN (SELECT value FROM json_each(?))'];
      const binds: unknown[] = [urlsJson];
      if (sinceMs !== undefined) {
        clauses.push(`${SORT_AT} >= ?`);
        binds.push(sinceMs);
      }
      if (position) {
        clauses.push(`(${SORT_AT} < ? OR (${SORT_AT} = ? AND seq < ?))`);
        binds.push(position.at, position.at, position.seq);
      }
      const res = await pollDb
        .prepare(
          `SELECT seq, feed_url, guid, title, link, author, published_at, first_seen_at, excerpt, ${SORT_AT} AS sort_at
           FROM polled_items WHERE ${clauses.join(' AND ')}
           ORDER BY ${SORT_AT} DESC, seq DESC LIMIT ?`,
        )
        .bind(...binds, PAGE_ROWS)
        .all<PolledRow>();
      const rows = res.results;
      const pageFull = rows.length === PAGE_ROWS;
      const ids = rows.map((row) => encodeItemId((feedByUrl.get(row.feed_url) as LiveFeed).feedId, row.guid));
      const flags = await loadFlags(ctx, ids);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const feed = feedByUrl.get(row.feed_url) as LiveFeed;
        const flag = flags.get(ids[i]);
        const isRead = flag?.read === 1;
        const isStarred = flag?.starred === 1;
        position = { at: row.sort_at, seq: row.seq };
        scanned++;
        const matches =
          (unread === undefined || unread === !isRead) &&
          (starred === undefined || starred === isStarred) &&
          (!query || row.title.toLowerCase().includes(query) || row.excerpt.toLowerCase().includes(query));
        if (!matches) continue;
        items.push({
          id: ids[i],
          feedId: feed.feedId,
          feedTitle: feed.title,
          title: row.title,
          link: redactNullable(row.link),
          author: row.author,
          publishedAt: isoDate(row.published_at ?? row.first_seen_at),
          excerpt: row.excerpt,
          read: isRead,
          starred: isStarred,
        });
        if (items.length >= limit) {
          hasMore = i < rows.length - 1 || pageFull;
          break scan;
        }
      }
      if (!pageFull) break;
      if (scanned >= MAX_SCAN_ROWS) {
        hasMore = true;
        break;
      }
    }
    const nextCursor = hasMore && position ? `${position.at}.${position.seq}` : null;

    const lines = items.map(
      (i) => `- ${i.read ? '' : '(unread) '}${i.starred ? '(starred) ' : ''}${i.title} | ${i.feedTitle} | ${i.publishedAt ?? 'undated'} | id: ${i.id}`,
    );
    if (nextCursor) lines.push(`More available: nextCursor ${nextCursor}`);
    return { data: { items, nextCursor }, text: items.length ? lines.join('\n') : 'No matching items.' };
  },
};

const DEFAULT_MAX_CHARS = 20_000;

const getItem: ToolDefinition = {
  name: 'get_item',
  title: 'Get an item',
  description:
    'Fetch one article by item ID (as returned by list_items), converted to Markdown. Content is truncated at maxChars (default 20000); truncated says whether it was. Only the last seven days of items are retained.',
  scope: 'read',
  needsPoll: true,
  annotations: READ_ONLY,
  inputSchema: {
    type: 'object',
    required: ['itemId'],
    properties: {
      itemId: { type: 'string', description: 'Item ID, in the form <feedId>::<guid>.' },
      maxChars: { type: 'integer', minimum: 100, maximum: 100000, description: 'Maximum Markdown characters. Defaults to 20000.' },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'feedId', 'feedTitle', 'title', 'link', 'author', 'publishedAt', 'read', 'starred', 'hasFullContent', 'truncated', 'totalChars', 'markdown'],
    properties: {
      id: { type: 'string' },
      feedId: { type: 'string' },
      feedTitle: { type: 'string' },
      title: { type: 'string' },
      link: nullableString,
      author: nullableString,
      publishedAt: nullableString,
      read: { type: 'boolean' },
      starred: { type: 'boolean' },
      hasFullContent: { type: 'boolean' },
      truncated: { type: 'boolean' },
      totalChars: { type: 'integer' },
      markdown: { type: 'string' },
    },
  },
  async run(ctx, args) {
    const pollDb = ctx.pollDb as D1Database;
    const itemId = args.itemId as string;
    const maxChars = typeof args.maxChars === 'number' ? args.maxChars : DEFAULT_MAX_CHARS;
    const parsed = decodeItemId(itemId);
    const feed = parsed ? (await loadLiveFeeds(ctx)).find((candidate) => candidate.feedId === parsed.feedId) : undefined;
    if (!parsed || !feed) throw new ToolError('Item not found. Use an item ID from list_items.');
    const row = await pollDb
      .prepare(
        'SELECT title, link, author, published_at, first_seen_at, excerpt, html FROM polled_items WHERE feed_url = ? AND guid = ?',
      )
      .bind(feed.url, parsed.guid)
      .first<Omit<PolledRow, 'seq' | 'feed_url' | 'guid' | 'sort_at'> & { html: string | null }>();
    if (!row) throw new ToolError('Item not found. Items are retained for seven days.');
    const hasFullContent = typeof row.html === 'string' && row.html.trim() !== '';
    const full = hasFullContent ? htmlToMarkdown(row.html as string) : htmlToMarkdown(row.excerpt);
    const truncated = full.length > maxChars;
    const markdown = truncated ? full.slice(0, maxChars) : full;
    const flag = (await loadFlags(ctx, [itemId])).get(itemId);
    const data = {
      id: itemId,
      feedId: feed.feedId,
      feedTitle: feed.title,
      title: row.title,
      link: redactNullable(row.link),
      author: row.author,
      publishedAt: isoDate(row.published_at ?? row.first_seen_at),
      read: flag?.read === 1,
      starred: flag?.starred === 1,
      hasFullContent,
      truncated,
      totalChars: full.length,
      markdown,
    };
    const header = `# ${row.title}\n${data.link ?? ''}${row.author ? `\nBy ${row.author}` : ''}\n\n`;
    return {
      data,
      text: `${header}${markdown}${truncated ? `\n\n[Truncated at ${maxChars} of ${full.length} characters]` : ''}`,
    };
  },
};

export const readTools: ToolDefinition[] = [listSubscriptions, getReadingStats, listItems, getItem];
