import { createSignal } from 'solid-js';
import { listFeeds, updateFeed, upsertFeed } from '../db/feeds';
import { bulkUpsertItems } from '../db/items';
import { runEviction } from '../articles/eviction';
import { fetchFeed } from './fetch';
import { parseFeed, parsedToItems } from './parse';
import type { Feed, FeedRefreshError } from '../db/types';
import {
  DEFAULT_LEARNED_INTERVAL_MS,
  MIN_LEARNED_INTERVAL_MS,
  ERROR_RETRY_FLOOR_MS,
  ERROR_RETRY_MAX_MS,
  RETRY_AFTER_CLAMP_MS,
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
    if (!f.url) return false;
    if (forceAll) return true;
    if (f.refreshError) return f.refreshError.retryAt <= now;
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

function nextRetryAt(status: number, retryAfterMs: number | undefined, attempts: number): number {
  const now = Date.now();
  if (status === 429 && retryAfterMs !== undefined) {
    const delay = Math.min(Math.max(0, retryAfterMs), RETRY_AFTER_CLAMP_MS);
    return now + delay;
  }
  const backoff = Math.min(ERROR_RETRY_FLOOR_MS * 2 ** (attempts - 1), ERROR_RETRY_MAX_MS);
  return now + backoff;
}

async function recordFeedError(feed: Feed, message: string, status: number, retryAfterMs?: number): Promise<void> {
  setFeedErrors((prev) => ({ ...prev, [feed.id]: message }));
  const attempts = (feed.refreshError?.attempts ?? 0) + 1;
  const refreshError: FeedRefreshError = {
    retryAt: nextRetryAt(status, retryAfterMs, attempts),
    attempts,
    lastStatus: status,
    lastRetryAfter: retryAfterMs ?? null,
  };
  await updateFeed(feed.id, { refreshError, lastError: message });
}

function clearFeedError(feed: Feed): void {
  setFeedErrors((prev) => {
    const next = { ...prev };
    delete next[feed.id];
    return next;
  });
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
      await recordFeedError(feed, result.message, result.status, result.retryAfterMs);
      return;
    }
    if (result.kind === 'not-modified') {
      await updateFeed(feed.id, {
        lastFetched: Date.now(),
        lastError: null,
        refreshError: null,
      });
      clearFeedError(feed);
      return;
    }
    const parsed = parseFeed(result.body);
    if (!parsed) {
      await recordFeedError(feed, 'Failed to parse feed', 200);
      return;
    }
    const items = parsedToItems(parsed, feed.id);
    if (items.length > 0) {
      await bulkUpsertItems(items);
    }
    const lastItemPublishedAt = items.length
      ? Math.max(...items.map((i) => i.publishedAt))
      : feed.lastItemPublishedAt ?? null;
    const learnedIntervalMs =
      feed.learnedIntervalMs > DEFAULT_LEARNED_INTERVAL_MS
        ? DEFAULT_LEARNED_INTERVAL_MS
        : adaptInterval(feed, items, lastItemPublishedAt);
    await upsertFeed({
      ...feed,
      title: feed.title || parsed.title,
      htmlUrl: feed.htmlUrl ?? parsed.htmlUrl,
      htmlUrlAt: feed.htmlUrlAt ?? (feed.htmlUrl == null && parsed.htmlUrl ? Date.now() : undefined),
      lastFetched: Date.now(),
      etag: result.etag ?? null,
      lastModified: result.lastModified ?? null,
      lastItemPublishedAt,
      learnedIntervalMs,
      lastError: null,
      refreshError: null,
    });
    clearFeedError(feed);
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
