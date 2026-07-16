/**
 * Feed subscription service.
 *
 * Single source of truth for the feed subscribe / unsubscribe operation.
 * Composes the three steps that callers used to do inline:
 *   1. Write to the local IndexedDB feed store.
 *   2. Enqueue a `feed-upsert` / `feed-delete` entry in the sync dirty queue.
 *   3. Schedule a flush so the change is pushed to the server.
 *
 * UI components should call the context methods (`ctx.subscribeFeed` /
 * `ctx.unsubscribeFeed` in `src/state.tsx`) which delegate here and also
 * refresh the Solid signals. Non-React callers (OPML import, tests, future
 * tooling) can call these service functions directly.
 */

import { upsertFeed, updateFeed, unsubscribeFeed as dbUnsubscribeFeed } from '../db/feeds';
import { enqueueFeed, enqueueFeedDelete } from '../sync/queue';
import { scheduleFlush } from '../sync/push';
import { DEFAULT_LEARNED_INTERVAL_MS } from '../db/types';

export interface SubscribeInput {
  url: string;
  title: string;
  folder?: string[];
  htmlUrl?: string;
  tags?: string[];
}

export async function subscribeFeed(input: SubscribeInput): Promise<void> {
  const now = Date.now();
  await upsertFeed({
    url: input.url,
    title: input.title,
    htmlUrl: input.htmlUrl,
    folder: input.folder,
    tags: input.tags,
    tagsAt: now,
    learnedIntervalMs: DEFAULT_LEARNED_INTERVAL_MS,
    lastFetched: null,
    lastItemPublishedAt: null,
  });
  enqueueFeed({
    feedUrl: input.url,
    folder: input.folder ?? null,
    folderAt: now,
    title: input.title,
    titleAt: now,
    tags: input.tags ?? null,
    tagsAt: now,
    deleted: 0,
    deletedAt: now,
  });
  scheduleFlush();
}

export async function updateFeedTags(feedUrl: string, tags: string[]): Promise<void> {
  const now = Date.now();
  await updateFeed(feedUrl, { tags, tagsAt: now });
  enqueueFeed({
    feedUrl,
    folder: null,
    folderAt: now,
    title: null,
    titleAt: now,
    tags,
    tagsAt: now,
    deleted: 0,
    deletedAt: now,
  });
  scheduleFlush();
}

export async function unsubscribeFeed(url: string): Promise<void> {
  await dbUnsubscribeFeed(url);
  enqueueFeedDelete(url, Date.now());
  scheduleFlush();
}
