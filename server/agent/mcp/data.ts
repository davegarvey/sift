import { ToolError, type ToolContext } from './types';
import type { StatsFeedInput } from '../../../packages/siftctl/src/stats';

export interface FeedRow extends StatsFeedInput {
  html_url: string | null;
  tags: string | null;
}

export interface LiveFeed {
  feedId: string;
  url: string;
  siteUrl: string | null;
  title: string;
  tags: string[];
}

export async function loadFeedRows(db: D1Database, syncKey: string): Promise<FeedRow[]> {
  const res = await db
    .prepare('SELECT feed_id, feed_url, html_url, title, tags, deleted FROM feeds WHERE sync_key = ? ORDER BY row_at ASC')
    .bind(syncKey)
    .all<FeedRow>();
  return res.results;
}

export function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

export function liveFeeds(rows: readonly FeedRow[]): LiveFeed[] {
  const seenUrls = new Set<string>();
  const feeds: LiveFeed[] = [];
  for (const row of rows) {
    if (row.deleted === 1 || !row.feed_id || !row.feed_url || seenUrls.has(row.feed_url)) continue;
    seenUrls.add(row.feed_url);
    feeds.push({
      feedId: row.feed_id,
      url: row.feed_url,
      siteUrl: row.html_url || null,
      title: row.title || row.feed_url,
      tags: parseTags(row.tags),
    });
  }
  return feeds;
}

export async function loadLiveFeeds(ctx: Pick<ToolContext, 'db' | 'syncKey'>): Promise<LiveFeed[]> {
  return liveFeeds(await loadFeedRows(ctx.db, ctx.syncKey));
}

export function urlKey(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

export function normaliseTags(input: readonly string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const tag = raw.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!tag) continue;
    if (tag === 'all') throw new ToolError('The tag "all" is reserved.');
    if (tag.length > 64) throw new ToolError('Tags must be 64 characters or fewer.');
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > 20) throw new ToolError('At most 20 tags are allowed.');
  return tags;
}

export function isoDate(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
