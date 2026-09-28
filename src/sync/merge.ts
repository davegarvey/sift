import { listFeeds } from '../db/feeds';
import { bulkUpsertItems, listItems } from '../db/items';
import { getItemFlags, type ItemFlag } from '../db/flags';
import { getFeedStats, listFeedStats, listPendingReadMarkers, applyRemoteStatistics } from '../db/stats';
import { enqueueFeed, enqueueFlag, enqueueStats, enqueueReadMarker, enqueueStatsIfSync, clearAllDirty } from './queue';
import { flushNow, scheduleFlush } from './push';
import { pullItemsAfter, pullSince, pullStatsSince, register, type PullPayload, type StatsPullPayload } from './client';
import { applyRemoteState, canonicalizeLocalFeedIds, type RemotePayload, type RemoteFeed, type RemoteFlag } from './apply';
import {
  getStoredLastItemsCursor,
  getStoredLastStatsSyncAt,
  getStoredLastSyncAt,
  setStoredLastItemsCursor,
  setStoredLastStatsSyncAt,
  setStoredLastSyncAt,
  setStoredServerOffset,
} from './key';
import { decodeItemId } from './itemId';
import { markPullSuccess, markError } from './status';
import type { Feed, Item } from '../db/types';
import { isItemSyncAvailable, isStatsSyncAvailable } from './capabilities';
import { parsedItemToItem } from '../feeds/parse';

export const MAX_ITEM_PAGES_PER_PULL = 50;

let onSync: (() => void) | null = null;

export function setOnSync(fn: (() => void) | null): void {
  onSync = fn;
}

function toRemotePayload(p: PullPayload): RemotePayload {
  return {
    serverTime: p.serverTime,
    feeds: p.feeds as unknown as RemoteFeed[], // why: PullPayload.feeds arrives as unknown[] from JSON parse
    flags: p.flags as unknown as RemoteFlag[], // why: same — runtime shape matches RemoteFlag after JSON parse
  };
}

function toRemoteStats(p: StatsPullPayload): { rows: Parameters<typeof applyRemoteStatistics>[0]; markers: Parameters<typeof applyRemoteStatistics>[1] } {
  const rows = p.stats.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (typeof row.feed_id !== 'string') return [];
    return [{
      feedId: row.feed_id,
      totalSeen: typeof row.total_seen === 'number' ? row.total_seen : 0,
      readOnce: typeof row.read_once === 'number' ? row.read_once : 0,
      feedUrl: typeof row.feed_url === 'string' ? row.feed_url : null,
      title: typeof row.title === 'string' ? row.title : null,
    }];
  });
  const markers = p.markers.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (typeof row.item_id !== 'string' || typeof row.feed_id !== 'string') return [];
    const parsed = decodeItemId(row.item_id);
    return [{
      id: parsed ? `${parsed.feedId}::${parsed.guid}` : row.item_id,
      feedId: row.feed_id,
    }];
  });
  return { rows, markers };
}

async function enqueueAllLocalStats(): Promise<void> {
  const [feeds, statsRows, markers] = await Promise.all([listFeeds(), listFeedStats(), listPendingReadMarkers()]);
  const statsByFeed = new Map(statsRows.map((row) => [row.feedId, row]));
  const now = Date.now();
  for (const feed of feeds) {
    const stats = statsByFeed.get(feed.id);
    enqueueStats({
      feedId: feed.id,
      totalSeen: stats?.totalSeen ?? 0,
      feedUrl: feed.url,
      title: feed.title,
      at: now,
    });
  }
  for (const marker of markers) {
    enqueueReadMarker({ itemId: marker.id, feedId: marker.feedId, at: now });
  }
}

export interface LocalSnapshot {
  feeds: Feed[];
  items: Item[];
  flagIds: Set<string>;
}

export async function snapshotLocal(): Promise<LocalSnapshot> {
  const feeds = await listFeeds();
  const items = await listItems();
  const flags = await getItemFlags();
  return {
    feeds,
    items,
    flagIds: new Set(flags.map((f) => f.id)),
  };
}

export async function mergeForFirstTime(
  _snapshot: LocalSnapshot,
  payload: RemotePayload,
  serverOffset = 0,
  canonicalFeedIds?: ReadonlyMap<string, string>,
): Promise<void> {
  await applyRemoteState(payload, serverOffset, canonicalFeedIds);
  onSync?.();
}

async function applyStatsPayload(payload: StatsPullPayload): Promise<void> {
  const stats = toRemoteStats(payload);
  await applyRemoteStatistics(stats.rows, stats.markers);
}

export async function runStatsPull(sinceOverride?: number): Promise<number | null> {
  if (!await isStatsSyncAvailable()) return null;
  const since = sinceOverride ?? (await getStoredLastStatsSyncAt()) ?? 0;
  const pull = await pullStatsSince(since);
  await applyStatsPayload(pull);
  const next = Math.max(since, pull.serverTime);
  await setStoredLastStatsSyncAt(next);
  return next;
}

export function toServerItems(rows: readonly unknown[], localFeedIds: ReadonlySet<string>): Item[] {
  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (typeof row.feed_id !== 'string' || !localFeedIds.has(row.feed_id)) return [];
    if (typeof row.guid !== 'string' || !row.guid || typeof row.first_seen_at !== 'number') return [];
    const text = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
    return [parsedItemToItem({
      guid: row.guid,
      title: text(row.title) ?? '(untitled)',
      link: text(row.link),
      author: text(row.author),
      publishedAt: typeof row.published_at === 'number' ? row.published_at : null,
      excerpt: typeof row.excerpt === 'string' ? row.excerpt : '',
      html: text(row.html),
      thumbnail: text(row.thumbnail) ?? null,
    }, row.feed_id, row.first_seen_at)];
  });
}

/**
 * Pulls server-polled items after the sync pull has applied feeds and
 * flags, inserting only items this device does not already hold. Returns
 * the number of items inserted.
 */
export async function runItemsPull(afterOverride?: number): Promise<number> {
  if (!await isItemSyncAvailable()) return 0;
  let cursor = afterOverride ?? (await getStoredLastItemsCursor()) ?? 0;
  const feeds = await listFeeds();
  const feedsById = new Map(feeds.map((feed) => [feed.id, feed]));
  const localFeedIds = new Set(feedsById.keys());
  const touched = new Set<string>();
  let inserted = 0;
  for (let page = 0; page < MAX_ITEM_PAGES_PER_PULL; page++) {
    const result = await pullItemsAfter(cursor);
    const byFeed = new Map<string, Item[]>();
    for (const item of toServerItems(result.items, localFeedIds)) {
      const group = byFeed.get(item.feedId) ?? [];
      group.push(item);
      byFeed.set(item.feedId, group);
    }
    for (const [feedId, group] of byFeed) {
      const ids = await bulkUpsertItems(group, { insertOnly: true });
      if (ids.length > 0) touched.add(feedId);
      inserted += ids.length;
    }
    cursor = result.cursor;
    await setStoredLastItemsCursor(cursor);
    if (!result.more) break;
  }
  for (const feedId of touched) {
    const feed = feedsById.get(feedId);
    const stats = await getFeedStats(feedId);
    await enqueueStatsIfSync({
      feedId,
      totalSeen: stats?.totalSeen ?? 0,
      feedUrl: feed?.url,
      title: feed?.title,
    });
  }
  if (touched.size > 0) scheduleFlush();
  return inserted;
}

async function pullItemsAndNotify(afterOverride?: number): Promise<void> {
  try {
    if (await runItemsPull(afterOverride) > 0) onSync?.();
  } catch (e) {
    console.error('Failed to pull server-polled items:', e);
  }
}

function toRawFlagId(itemId: string): string {
  const parsed = decodeItemId(itemId);
  return parsed ? `${parsed.feedId}::${parsed.guid}` : itemId;
}

/**
 * Pushes only the local feeds/flags the server does not already have.
 * Feeds are skipped when the server has a row with the same feed_id or URL;
 * flags are skipped when the server has a row for the same raw item ID
 * (server item_ids are URL-encoded, so they are normalized first). Rows the
 * server already knows are left to applyRemoteState's LWW merge instead of
 * being re-stamped with fresh timestamps.
 */
async function pushLocalDiff(feeds: Feed[], flags: ItemFlag[], serverFeeds: RemoteFeed[], serverFlags: RemoteFlag[]): Promise<void> {
  const serverFeedIds = new Set(serverFeeds.map((f) => f.feed_id));
  const serverFeedUrls = new Set<string>();
  for (const f of serverFeeds) {
    if (f.feed_url) serverFeedUrls.add(f.feed_url);
  }
  const serverFlagIds = new Set(serverFlags.map((f) => toRawFlagId(f.item_id)));

  const now = Date.now();
  for (const feed of feeds) {
    if (!feed.url) continue;
    if (serverFeedIds.has(feed.id) || serverFeedUrls.has(feed.url)) continue;
    enqueueFeed({
      feedId: feed.id,
      folder: feed.folder ?? null,
      folderAt: now,
      title: feed.title,
      titleAt: now,
      feedUrl: { value: feed.url, at: now },
      htmlUrl: feed.htmlUrl ? { value: feed.htmlUrl, at: now } : null,
      tags: feed.tags ?? null,
      tagsAt: now,
      deleted: 0,
      deletedAt: now,
    });
  }
  for (const flag of flags) {
    if (flag.read === 0 && flag.starred === 0) continue;
    if (serverFlagIds.has(flag.id)) continue;
    enqueueFlag({
      itemId: flag.id,
      feedId: flag.feedId,
      read: flag.read,
      readAt: now,
      starred: flag.starred,
      starredAt: now,
    });
  }
  await flushNow();
}

async function mergePayload(
  payload: RemotePayload,
  serverTime: number,
  canonicalFeedIds?: ReadonlyMap<string, string>,
): Promise<void> {
  const offset = serverTime - Date.now();
  await setStoredServerOffset(offset);
  const snap = await snapshotLocal();
  await mergeForFirstTime(snap, payload, offset, canonicalFeedIds);
  await flushNow();
  const newTime = Math.max(await getStoredLastSyncAt() ?? 0, serverTime);
  await setStoredLastSyncAt(newTime);
}

export async function runFirstTimeSetup(): Promise<number> {
  // Registration is explicit: ensure the server knows this key before the
  // first pull. Idempotent (INSERT OR IGNORE); a rotated key is refused
  // with 403 and the setup fails, which is the intended outcome.
  await register();

  // Start clean: any dirty entries from a previous partial setup, or from
  // changes made while sync was disabled, are superseded by the diff below
  // (the diff is computed from local DB state, not from the dirty queue).
  await clearAllDirty();

  try {
    const statsSupported = await isStatsSyncAvailable();
    let statsPull: StatsPullPayload | null = null;
    if (statsSupported) {
      statsPull = await pullStatsSince(0);
    }
    const pull = await pullSince(0);
    const payload = toRemotePayload(pull);
    const canonicalFeedIds = await canonicalizeLocalFeedIds(payload.feeds);
    const existingFeeds = await listFeeds();
    const existingFlags = await getItemFlags();
    await pushLocalDiff(existingFeeds, existingFlags, payload.feeds, payload.flags);
    await mergePayload(payload, pull.serverTime, canonicalFeedIds);
    await pullItemsAndNotify(0);
    if (statsPull) {
      await applyStatsPayload(statsPull);
      await setStoredLastStatsSyncAt(statsPull.serverTime);
    }
    if (statsSupported) {
      await enqueueAllLocalStats();
      await flushNow();
      await runStatsPull();
    }
  } catch (e) {
    markError('pull', e);
    throw e;
  }
  const cursor = (await getStoredLastSyncAt()) ?? 0;
  markPullSuccess();
  return cursor;
}

export async function runPull(): Promise<number | null> {
  try {
    const since = (await getStoredLastSyncAt()) ?? 0;
    const pull = await pullSince(since);
    const offset = pull.serverTime - Date.now();
    await setStoredServerOffset(offset);
    const payload = toRemotePayload(pull);
    if (payload.feeds.length === 0 && payload.flags.length === 0) {
      await setStoredLastSyncAt(Math.max(since, pull.serverTime));
    } else {
      await applyRemoteState(payload, offset);
      const newTime = Math.max(since, pull.serverTime);
      await setStoredLastSyncAt(newTime);
      scheduleFlush();
      onSync?.();
    }
    await pullItemsAndNotify();
    await runStatsPull();
    markPullSuccess();
    return Math.max(since, pull.serverTime);
  } catch (e) {
    markError('pull', e);
    throw e;
  }
}
