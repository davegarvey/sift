import { createSignal } from 'solid-js';
import { listFeeds, updateFeed, upsertFeed } from '../db/feeds';
import { bulkUpsertItems } from '../db/items';
import { runEviction } from '../articles/eviction';
import { fetchFeed } from './fetch';
import { parseFeed, parsedToItems } from './parse';
import type { Feed } from '../db/types';
import {
  DEFAULT_LEARNED_INTERVAL_MS,
  MIN_LEARNED_INTERVAL_MS,
  MAX_LEARNED_INTERVAL_MS,
} from '../db/types';
import { isIdle } from '../util/idle';

const TICK_MS = 5 * 60 * 1000;

const [inFlight, setInFlight] = createSignal(0);
const [feedErrors, setFeedErrors] = createSignal<Record<string, string>>({});
const [fetchingFeeds, setFetchingFeeds] = createSignal<Set<string>>(new Set());

let tickTimer: ReturnType<typeof setInterval> | null = null;
let onRefresh: (() => void) | null = null;

export function setOnRefresh(fn: (() => void) | null): void {
  onRefresh = fn;
}

export function startScheduler(): void {
  if (tickTimer) return;
  void refreshStaleFeeds();
  tickTimer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    void refreshStaleFeeds();
  }, TICK_MS);
}

export function stopScheduler(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

export const fetchingState = {
  inFlight,
  setInFlight,
  feedErrors,
  fetchingFeeds,
};

export async function refreshStaleFeeds(forceAll = false): Promise<void> {
  const feeds = await listFeeds();
  const now = Date.now();
  const stale = feeds.filter((f) => {
    if (forceAll) return true;
    if (f.lastFetched == null) return true;
    return f.lastFetched + f.learnedIntervalMs < now;
  });
  await mapConcurrent(stale, (f) => refreshFeed(f), 4);
  void runEviction();
  if (!forceAll && stale.length > 0 && onRefresh && !isIdle()) {
    onRefresh();
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  const entries = items.map((item, i) => ({ item, i }));
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (entries.length > 0) {
      const { item, i } = entries.shift()!;
      results[i] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function refreshFeed(feed: Feed): Promise<void> {
  setInFlight((n) => n + 1);
  setFetchingFeeds((prev) => new Set(prev).add(feed.id));
  try {
    const result = await fetchFeed(feed.url, {
      etag: feed.etag,
      lastModified: feed.lastModified,
    });
    if (result.kind === 'error') {
      setFeedErrors((prev) => ({ ...prev, [feed.id]: result.message }));
      await updateFeed(feed.id, { lastError: result.message });
      return;
    }
    if (result.kind === 'not-modified') {
      await updateFeed(feed.id, {
        lastFetched: Date.now(),
        lastError: null,
      });
      setFeedErrors((prev) => {
        const next = { ...prev };
        delete next[feed.id];
        return next;
      });
      return;
    }
    const parsed = parseFeed(result.body);
    if (!parsed) {
      setFeedErrors((prev) => ({ ...prev, [feed.id]: 'Failed to parse feed' }));
      await updateFeed(feed.id, { lastError: 'Failed to parse feed' });
      return;
    }
    const items = parsedToItems(parsed, feed.id);
    if (items.length > 0) {
      await bulkUpsertItems(items);
    }
    const lastItemPublishedAt = items.length
      ? Math.max(...items.map((i) => i.publishedAt))
      : feed.lastItemPublishedAt ?? null;
    const learnedIntervalMs = adaptInterval(feed, items, lastItemPublishedAt);
    await upsertFeed({
      ...feed,
      title: feed.title || parsed.title,
      htmlUrl: feed.htmlUrl ?? parsed.htmlUrl,
      htmlUrlAt: feed.htmlUrlAt ?? (feed.htmlUrl == null && parsed.htmlUrl ? Date.now() : undefined),
      urlAt: feed.urlAt ?? Date.now(),
      lastFetched: Date.now(),
      etag: result.etag ?? null,
      lastModified: result.lastModified ?? null,
      lastItemPublishedAt,
      learnedIntervalMs,
      lastError: null,
    });
    setFeedErrors((prev) => {
      const next = { ...prev };
      delete next[feed.id];
      return next;
    });
  } finally {
    setFetchingFeeds((prev) => {
      const next = new Set(prev);
      next.delete(feed.id);
      return next;
    });
    setInFlight((n) => Math.max(0, n - 1));
  }
}

function adaptInterval(feed: Feed, newItems: { publishedAt: number }[], latest: number | null): number {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (newItems.length === 0 || latest == null) return feed.learnedIntervalMs;
  const itemsPerDay = newItems.length / Math.max(1, (now - latest) / day);
  if (itemsPerDay > 10) {
    return Math.max(MIN_LEARNED_INTERVAL_MS, Math.floor(feed.learnedIntervalMs / 2));
  }
  return feed.learnedIntervalMs;
}
