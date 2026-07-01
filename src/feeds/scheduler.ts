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

const TICK_MS = 5 * 60 * 1000;

const [inFlight, setInFlight] = createSignal(0);
const [feedErrors, setFeedErrors] = createSignal<Record<string, string>>({});
const [fetchingFeeds, setFetchingFeeds] = createSignal<Set<string>>(new Set());

let tickTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Single entry point: kick the scheduler once on app open, and start a
 * periodic tick loop. Idempotent — safe to call multiple times.
 */
export function startScheduler(): void {
  if (tickTimer) return;
  void refreshStaleFeeds();
  tickTimer = setInterval(() => void refreshStaleFeeds(), TICK_MS);
}

export function stopScheduler(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

export const fetchingState = {
  inFlight,
  feedErrors,
  fetchingFeeds,
};

/**
 * Refresh all feeds whose `lastFetched + learnedIntervalMs < now`.
 * Called automatically on tick and on app open. Also exported for the
 * "Refresh all" command — that path bypasses staleness and refreshes
 * every feed regardless.
 */
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
}

/** Run async tasks with at most `concurrency` in-flight at once. */
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

/**
 * Refresh a single feed: fetch via the proxy, parse, insertOrUpdate each
 * item, update the feed record's metadata and the learned interval.
 * On 304 we update only `lastFetched` (no item parsing, no learned-interval
 * adaptation — there's nothing to learn from no-new-items).
 */
export async function refreshFeed(feed: Feed): Promise<void> {
  setInFlight((n) => n + 1);
  setFetchingFeeds((prev) => new Set(prev).add(feed.url));
  try {
    const result = await fetchFeed(feed.url, {
      etag: feed.etag,
      lastModified: feed.lastModified,
    });
    if (result.kind === 'error') {
      setFeedErrors((prev) => ({ ...prev, [feed.url]: result.message }));
      await updateFeed(feed.url, { lastError: result.message });
      return;
    }
    if (result.kind === 'not-modified') {
      await updateFeed(feed.url, {
        lastFetched: Date.now(),
        lastError: null,
      });
      setFeedErrors((prev) => {
        const next = { ...prev };
        delete next[feed.url];
        return next;
      });
      return;
    }
    const parsed = parseFeed(result.body);
    if (!parsed) {
      setFeedErrors((prev) => ({ ...prev, [feed.url]: 'Failed to parse feed' }));
      await updateFeed(feed.url, { lastError: 'Failed to parse feed' });
      return;
    }
    const items = parsedToItems(parsed, feed.url);
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
      lastFetched: Date.now(),
      etag: result.etag ?? null,
      lastModified: result.lastModified ?? null,
      lastItemPublishedAt,
      learnedIntervalMs,
      lastError: null,
    });
    setFeedErrors((prev) => {
      const next = { ...prev };
      delete next[feed.url];
      return next;
    });
  } finally {
    setFetchingFeeds((prev) => {
      const next = new Set(prev);
      next.delete(feed.url);
      return next;
    });
    setInFlight((n) => Math.max(0, n - 1));
  }
}

/**
 * Heuristic from design D8: track observed item arrivals; if a feed
 * publishes >10 items/day, halve the interval toward the 30-min floor; if
 * <2 items/day observed for ≥5 days, double toward the 24-hour ceiling.
 */
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