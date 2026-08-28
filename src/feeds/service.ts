import { upsertFeed, updateFeed, getFeed, getFeedByUrl, unsubscribeFeed as dbUnsubscribeFeed } from '../db/feeds';
import { enqueueFeed, enqueueFeedDelete, enqueueStatsIfSync } from '../sync/queue';
import { scheduleFlush } from '../sync/push';
import { DEFAULT_LEARNED_INTERVAL_MS } from '../db/types';
import type { Feed } from '../db/types';
import { ensureFeedStats, getFeedStats, updateFeedStatsLabel } from '../db/stats';

export interface SubscribeInput {
  url: string;
  title: string;
  folder?: string[];
  htmlUrl?: string;
  tags?: string[];
}

export async function subscribeFeed(input: SubscribeInput): Promise<string> {
  const now = Date.now();
  const id = crypto.randomUUID();
  const feed: Feed = {
    id,
    url: input.url,
    urlAt: now,
    title: input.title,
    titleAt: now,
    htmlUrl: input.htmlUrl,
    htmlUrlAt: input.htmlUrl ? now : null,
    folder: input.folder,
    tags: input.tags,
    tagsAt: now,
    modifiedAt: now,
    learnedIntervalMs: DEFAULT_LEARNED_INTERVAL_MS,
    lastFetched: null,
    lastItemPublishedAt: null,
  };
  await upsertFeed(feed);
  await ensureFeedStats(feed);
  await enqueueStatsIfSync({ feedId: feed.id, totalSeen: 0, feedUrl: feed.url, title: feed.title });
  enqueueFeed({
    feedId: id,
    folder: input.folder ?? null,
    folderAt: now,
    title: input.title,
    titleAt: now,
    feedUrl: { value: input.url, at: now },
    htmlUrl: input.htmlUrl ? { value: input.htmlUrl, at: now } : null,
    tags: input.tags ?? null,
    tagsAt: now,
    deleted: 0,
    deletedAt: now,
  });
  scheduleFlush();
  return id;
}

export async function updateFeedMeta(
  feedId: string,
  meta: { title?: string; tags?: string[] }
): Promise<void> {
  const now = Date.now();
  const feed = await getFeed(feedId);
  const patch: Partial<Feed> = { modifiedAt: now };
  if (meta.title !== undefined) {
    patch.title = meta.title;
    patch.titleAt = now;
  }
  if (meta.tags !== undefined) {
    patch.tags = meta.tags;
    patch.tagsAt = now;
  }
  await updateFeed(feedId, patch);
  if (feed) {
    const title = patch.title ?? feed.title;
    await updateFeedStatsLabel({ id: feed.id, title, url: feed.url });
    const stats = await getFeedStats(feed.id);
    await enqueueStatsIfSync({ feedId: feed.id, totalSeen: stats?.totalSeen ?? 0, feedUrl: feed.url, title });
  }
  enqueueFeed({
    feedId,
    folder: null,
    folderAt: now,
    title: meta.title ?? null,
    titleAt: now,
    feedUrl: feed ? { value: feed.url, at: now } : null,
    htmlUrl: feed?.htmlUrl ? { value: feed.htmlUrl, at: now } : null,
    tags: meta.tags ?? null,
    tagsAt: now,
    deleted: null,
    deletedAt: null,
  });
  scheduleFlush();
}

export async function changeFeedUrl(feedId: string, newUrl: string): Promise<void> {
  const trimmed = newUrl.trim();
  if (!trimmed) throw new Error('URL is required');
  try { new URL(trimmed); } catch { throw new Error('Invalid feed URL'); }

  const existing = await getFeedByUrl(trimmed);
  if (existing && existing.id !== feedId) {
    throw new Error('Already subscribed to this URL');
  }

  const feed = await getFeed(feedId);
  const now = Date.now();
  await updateFeed(feedId, {
    url: trimmed,
    urlAt: now,
    modifiedAt: now,
    etag: null,
    lastModified: null,
    refreshError: null,
  });
  if (feed) {
    await updateFeedStatsLabel({ id: feed.id, title: feed.title, url: trimmed });
    const stats = await getFeedStats(feed.id);
    await enqueueStatsIfSync({ feedId: feed.id, totalSeen: stats?.totalSeen ?? 0, feedUrl: trimmed, title: feed.title });
  }
  enqueueFeed({
    feedId,
    folder: null,
    folderAt: now,
    title: null,
    titleAt: now,
    feedUrl: { value: trimmed, at: now },
    htmlUrl: feed?.htmlUrl ? { value: feed.htmlUrl, at: now } : null,
    tags: null,
    tagsAt: now,
    deleted: null,
    deletedAt: null,
  });
  scheduleFlush();
}

export async function updateFeedTags(feedId: string, tags: string[]): Promise<void> {
  return updateFeedMeta(feedId, { tags });
}

export async function unsubscribeFeed(feedId: string): Promise<void> {
  const feed = await getFeed(feedId);
  await dbUnsubscribeFeed(feedId);
  const now = Date.now();
  enqueueFeedDelete(feedId, { value: feed?.url ?? '', at: now }, now);
  scheduleFlush();
}
