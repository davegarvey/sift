import { upsertFeed, updateFeed, getFeedByUrl, unsubscribeFeed as dbUnsubscribeFeed } from '../db/feeds';
import { enqueueFeed, enqueueFeedDelete } from '../sync/queue';
import { scheduleFlush } from '../sync/push';
import { DEFAULT_LEARNED_INTERVAL_MS } from '../db/types';
import type { Feed } from '../db/types';

export interface SubscribeInput {
  url: string;
  title: string;
  folder?: string[];
  htmlUrl?: string;
  tags?: string[];
}

export async function subscribeFeed(input: SubscribeInput): Promise<void> {
  const now = Date.now();
  const id = crypto.randomUUID();
  await upsertFeed({
    id,
    url: input.url,
    title: input.title,
    titleAt: now,
    htmlUrl: input.htmlUrl,
    folder: input.folder,
    tags: input.tags,
    tagsAt: now,
    learnedIntervalMs: DEFAULT_LEARNED_INTERVAL_MS,
    lastFetched: null,
    lastItemPublishedAt: null,
  });
  enqueueFeed({
    feedId: id,
    folder: input.folder ?? null,
    folderAt: now,
    title: input.title,
    titleAt: now,
    feedUrl: null,
    tags: input.tags ?? null,
    tagsAt: now,
    deleted: 0,
    deletedAt: now,
  });
  scheduleFlush();
}

export async function updateFeedMeta(
  feedId: string,
  meta: { title?: string; tags?: string[] }
): Promise<void> {
  const now = Date.now();
  const patch: Partial<Feed> = {};
  if (meta.title !== undefined) {
    patch.title = meta.title;
    patch.titleAt = now;
  }
  if (meta.tags !== undefined) {
    patch.tags = meta.tags;
    patch.tagsAt = now;
  }
  await updateFeed(feedId, patch);
  enqueueFeed({
    feedId,
    folder: null,
    folderAt: now,
    title: meta.title ?? null,
    titleAt: now,
    feedUrl: null,
    tags: meta.tags ?? null,
    tagsAt: now,
    deleted: 0,
    deletedAt: now,
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

  const now = Date.now();
  await updateFeed(feedId, {
    url: trimmed,
    urlAt: now,
    etag: null,
    lastModified: null,
  });
  enqueueFeed({
    feedId,
    folder: null,
    folderAt: now,
    title: null,
    titleAt: now,
    feedUrl: { value: trimmed, at: now },
    tags: null,
    tagsAt: now,
    deleted: 0,
    deletedAt: now,
  });
  scheduleFlush();
}

export async function updateFeedTags(feedId: string, tags: string[]): Promise<void> {
  return updateFeedMeta(feedId, { tags });
}

export async function unsubscribeFeed(feedId: string): Promise<void> {
  await dbUnsubscribeFeed(feedId);
  enqueueFeedDelete(feedId, Date.now());
  scheduleFlush();
}
