import { createSignal } from 'solid-js';
import { listFeeds, updateFeed, upsertFeed } from '../db/feeds';
import { bulkUpsertItems } from '../db/items';
import { runEviction } from '../articles/eviction';
import { fetchFeed, type FeedSourceStatus } from './fetch';
import { parseFeed, parsedToItems } from './parse';
import type { RefreshTarget } from './scope';
import type { Feed, FeedRefreshError } from '../db/types';
import {
  DEFAULT_LEARNED_INTERVAL_MS,
  MIN_LEARNED_INTERVAL_MS,
  ERROR_RETRY_FLOOR_MS,
  ERROR_RETRY_MAX_MS,
} from '../db/types';
import { isIdle } from '../util/idle';
import { ensureFeedStats, getFeedStats } from '../db/stats';
import { enqueueStatsIfSync } from '../sync/queue';

const TICK_MS = 5 * 60 * 1000;
const QUIET_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_FAILURE_STATUSES = new Set([0, 408, 419, 425, 429]);
const FEED_JITTER_WINDOW_MS = 15 * 60 * 1000;

const [inFlight, setInFlight] = createSignal(0);
const [feedErrors, setFeedErrors] = createSignal<Record<string, string>>({});
const [fetchingFeeds, setFetchingFeeds] = createSignal<Set<string>>(new Set());
const feedRefreshes = new Map<string, Promise<void>>();

let tickTimer: ReturnType<typeof setInterval> | null = null;
let dueTimer: ReturnType<typeof setTimeout> | null = null;
let schedulerEpoch: number | null = null;
let onRefresh: (() => void) | null = null;

export function setOnRefresh(fn: (() => void) | null): void {
  onRefresh = fn;
}

export function startScheduler(): void {
  if (tickTimer) return;
  schedulerEpoch = Date.now();
  void refreshStaleFeeds();
  tickTimer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    void refreshStaleFeeds();
  }, TICK_MS);
  void scheduleAutomaticRun();
}

export function stopScheduler(): void {
  if (tickTimer) clearInterval(tickTimer);
  if (dueTimer) clearTimeout(dueTimer);
  tickTimer = null;
  dueTimer = null;
  schedulerEpoch = null;
}

export const fetchingState = {
  inFlight,
  setInFlight,
  feedErrors,
  fetchingFeeds,
};

export interface RefreshOptions {
  forceAll?: boolean;
  target?: RefreshTarget;
}

export async function refreshStaleFeeds(options: RefreshOptions = {}): Promise<void> {
  const forceAll = options.forceAll ?? false;
  const target = options.target;
  const feeds = await listFeeds();
  const now = Date.now();
  const stale = feeds.filter((f) => {
    if (!f.url) return false;
    if (target !== undefined && !target.has(f.id)) return false;
    if (f.refreshError && f.refreshError.retryAt > now) return false;
    if (forceAll) return true;
    return scheduledFeedDueAt(f, schedulerEpoch, now) <= now;
  });
  await mapConcurrent(stale, (f) => refreshFeed(f), 4);
  void runEviction();
  if (!forceAll && stale.length > 0 && onRefresh && !isIdle()) {
    onRefresh();
  }
  void scheduleAutomaticRun();
}

export function stableFeedJitter(feedId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < feedId.length; index += 1) {
    hash ^= feedId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % FEED_JITTER_WINDOW_MS;
}

export function scheduledFeedDueAt(feed: Feed, startedAt: number | null, now = Date.now()): number {
  const cadenceAt = feed.refreshError?.retryAt
    ?? (feed.lastFetched == null ? (startedAt ?? now) : feed.lastFetched + feed.learnedIntervalMs);
  const startupFloor = startedAt ?? cadenceAt;
  return Math.max(cadenceAt, startupFloor) + (startedAt === null ? 0 : stableFeedJitter(feed.id));
}

async function scheduleAutomaticRun(): Promise<void> {
  if (!tickTimer || schedulerEpoch === null) return;
  if (dueTimer) clearTimeout(dueTimer);
  const feeds = await listFeeds();
  const nextAt = feeds
    .filter((feed) => Boolean(feed.url))
    .reduce((earliest, feed) => Math.min(earliest, scheduledFeedDueAt(feed, schedulerEpoch)), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(nextAt)) return;
  dueTimer = setTimeout(() => {
    dueTimer = null;
    if (document.visibilityState !== 'hidden') {
      void refreshStaleFeeds();
    }
  }, Math.max(0, nextAt - Date.now()));
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
  if ((status === 429 || status === 419) && retryAfterMs !== undefined) {
    return now + Math.max(0, retryAfterMs);
  }
  const backoff = Math.min(ERROR_RETRY_FLOOR_MS * 2 ** (attempts - 1), ERROR_RETRY_MAX_MS);
  return now + backoff;
}

export function isQuietFeedFailure(feed: Feed, status: number, now = Date.now()): boolean {
  const transient = TRANSIENT_FAILURE_STATUSES.has(status) || (status >= 500 && status <= 599);
  const receivedAt = feed.sourceFetchedAt ?? feed.lastFetched;
  return transient && receivedAt != null && now - receivedAt < QUIET_FAILURE_WINDOW_MS;
}

function sourceFields(status: FeedSourceStatus, now: number): Pick<Feed, 'sourceFetchedAt' | 'nextCheckAt'> {
  return {
    sourceFetchedAt: now - status.sourceAgeMs,
    nextCheckAt: status.nextCheckInMs === undefined ? null : now + status.nextCheckInMs,
  };
}

async function recordFeedError(feed: Feed, message: string, status: number, retryAfterMs?: number): Promise<void> {
  if (isQuietFeedFailure(feed, status)) {
    clearFeedError(feed);
  } else {
    setFeedErrors((prev) => ({ ...prev, [feed.id]: message }));
  }
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

export function refreshFeed(feed: Feed): Promise<void> {
  const existing = feedRefreshes.get(feed.id);
  if (existing) return existing;

  const operation = refreshFeedOnce(feed);
  const tracked = operation.finally(() => {
    if (feedRefreshes.get(feed.id) === tracked) feedRefreshes.delete(feed.id);
  });
  feedRefreshes.set(feed.id, tracked);
  return tracked;
}

async function refreshFeedOnce(feed: Feed): Promise<void> {
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
      const now = Date.now();
      await updateFeed(feed.id, {
        lastFetched: now,
        ...sourceFields(result, now),
        lastError: null,
        refreshError: null,
      });
      clearFeedError(feed);
      return;
    }
    const parsed = parseFeed(result.body, feed.url);
    if (!parsed) {
      await recordFeedError(feed, 'Failed to parse feed', 200);
      return;
    }
    const items = parsedToItems(parsed, feed.id);
    let newItemIds: string[] = [];
    if (items.length > 0) {
      newItemIds = await bulkUpsertItems(items);
    }
    const lastItemPublishedAt = items.length
      ? Math.max(...items.map((i) => i.publishedAt))
      : feed.lastItemPublishedAt ?? null;
    const learnedIntervalMs =
      feed.learnedIntervalMs > DEFAULT_LEARNED_INTERVAL_MS
        ? DEFAULT_LEARNED_INTERVAL_MS
        : adaptInterval(feed, newItemIds.length, Date.now() - (feed.lastFetched ?? Date.now()));
    const updatedFeed: Feed = {
      ...feed,
      title: feed.title || parsed.title,
      htmlUrl: feed.htmlUrl ?? parsed.htmlUrl,
      htmlUrlAt: feed.htmlUrlAt ?? (feed.htmlUrl == null && parsed.htmlUrl ? Date.now() : undefined),
      lastFetched: Date.now(),
      ...sourceFields(result, Date.now()),
      etag: result.etag ?? null,
      lastModified: result.lastModified ?? null,
      lastItemPublishedAt,
      learnedIntervalMs,
      lastError: null,
      refreshError: null,
    };
    await upsertFeed(updatedFeed);
    await ensureFeedStats(updatedFeed);
    const stats = await getFeedStats(updatedFeed.id);
    await enqueueStatsIfSync({
      feedId: updatedFeed.id,
      totalSeen: stats?.totalSeen ?? 0,
      feedUrl: updatedFeed.url,
      title: updatedFeed.title,
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

function adaptInterval(feed: Feed, newItemCount: number, elapsedMs: number): number {
  const day = 24 * 60 * 60 * 1000;
  if (feed.lastFetched == null || newItemCount === 0) return feed.learnedIntervalMs;
  const itemsPerDay = newItemCount / Math.max(1 / 24, elapsedMs / day);
  if (itemsPerDay > 10) {
    return Math.max(MIN_LEARNED_INTERVAL_MS, Math.floor(feed.learnedIntervalMs / 2));
  }
  return feed.learnedIntervalMs;
}
