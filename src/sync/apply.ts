/**
 * Apply remote state to the local IndexedDB.
 *
 * For each remote feed, upsert into local with per-field newer-wins.
 * For each tombstoned feed (deleted=1), call unsubscribeFeed only if
 * the remote deleted_at is newer than the local lastFetched.
 * For each remote flag, upsert into itemFlags and (if the item exists
 * locally) update items.read/starred.
 */

import { upsertFeed, getFeedByUrl, unsubscribeFeed, listFeeds } from '../db/feeds';
import { getItem, listItems, bulkUpsertItems, updateItem } from '../db/items';
import { bulkSetFlags, getItemFlags, READ_UNREAD, READ_READ, STAR_UNSTARRED, STAR_STARRED, type ItemFlag } from '../db/flags';
import type { Feed, Item } from '../db/types';
import { decodeItemId, encodeItemId } from './itemId';

export interface RemoteFeed {
  feed_url: string;
  folder?: string | null;
  folder_at?: number | null;
  title?: string | null;
  title_at?: number | null;
  deleted?: 0 | 1;
  deleted_at?: number | null;
  row_at: number;
}

export interface RemoteFlag {
  item_id: string;
  feed_url: string;
  read?: 0 | 1 | null;
  read_at?: number | null;
  starred?: 0 | 1 | null;
  starred_at?: number | null;
  row_at: number;
}

export interface RemotePayload {
  serverTime: number;
  feeds: RemoteFeed[];
  flags: RemoteFlag[];
}

function newer<T>(remote: T | null | undefined, local: T | null | undefined, at: number | null | undefined, localAt: number | null | undefined): T | null {
  if (at == null) return local ?? null;
  if (localAt == null) return remote ?? null;
  return at > localAt ? remote ?? null : local ?? null;
}

function parseFolder(s: string | null | undefined): string[] | undefined {
  if (s == null) return undefined;
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v as string[];
  } catch {
    // fall through
  }
  return undefined;
}

export async function applyRemoteState(payload: RemotePayload): Promise<void> {
  // 1) Feeds.
  const localFeeds = await listFeeds();
  const localByUrl = new Map<string, Feed>(localFeeds.map((f) => [f.url, f]));
  const tombstonedForUnsubscribe: string[] = [];
  for (const rf of payload.feeds) {
    const local = localByUrl.get(rf.feed_url);
    const remoteFolder = parseFolder(rf.folder);
    const merged: Feed = {
      url: rf.feed_url,
      title: newer(rf.title ?? null, local?.title ?? null, rf.title_at ?? null, local?.lastFetched ?? null) ?? '',
      htmlUrl: local?.htmlUrl,
      folder: newer(remoteFolder ?? null, local?.folder ?? null, rf.folder_at ?? null, local?.lastFetched ?? null) ?? undefined,
      lastFetched: Math.max(local?.lastFetched ?? 0, rf.row_at),
      etag: local?.etag,
      lastModified: local?.lastModified,
      learnedIntervalMs: local?.learnedIntervalMs ?? 60 * 60 * 1000,
      lastError: local?.lastError,
      lastItemPublishedAt: local?.lastItemPublishedAt,
      recentPublishCounts: local?.recentPublishCounts,
    };
    await upsertFeed(merged);
    if (rf.deleted === 1 && rf.deleted_at != null) {
      const isNewer = !local || (local.lastFetched ?? 0) < rf.deleted_at;
      if (isNewer) tombstonedForUnsubscribe.push(rf.feed_url);
    }
  }
  for (const url of tombstonedForUnsubscribe) {
    await unsubscribeFeed(url);
  }

  // 2) Flags.
  const localItems = await listItems();
  const localById = new Map<string, Item>(localItems.map((it) => [it.id, it]));
  const existingFlags = await getItemFlags();
  const flagMap = new Map(existingFlags.map((f) => [f.id, f]));

  for (const rf of payload.flags) {
    const parsed = decodeItemId(rf.item_id);
    const rawId = parsed ? `${parsed.feedUrl}::${parsed.guid}` : rf.item_id;
    const existing: ItemFlag | undefined = flagMap.get(rawId);
    const existingRead = existing ? (existing.read as 0 | 1) : null;
    const existingStarred = existing ? (existing.starred as 0 | 1) : null;
    const mergedRead = newer(rf.read ?? null, existingRead, rf.read_at ?? null, null);
    const mergedStarred = newer(rf.starred ?? null, existingStarred, rf.starred_at ?? null, null);
    const flagRow: ItemFlag = {
      id: rawId,
      feedUrl: rf.feed_url,
      read: mergedRead === null ? READ_UNREAD : (mergedRead as 0 | 1),
      starred: mergedStarred === null ? STAR_UNSTARRED : (mergedStarred as 0 | 1),
    };
    flagMap.set(rawId, flagRow);
  }
  await bulkSetFlags(Array.from(flagMap.values()));

  // Persist read/starred changes for items present locally. We use updateItem
  // (not bulkUpsertItems) because bulkUpsertItems is designed to preserve
  // existing read/starred on a refresh. The apply path wants the opposite:
  // it has authoritative flag state and should set it.
  for (const f of flagMap.values()) {
    const localItem = localById.get(f.id);
    if (!localItem) continue;
    const targetRead = f.read === 1;
    const targetStarred = f.starred === 1;
    if (localItem.read !== targetRead || localItem.starred !== targetStarred) {
      await updateItem(f.id, { read: targetRead, starred: targetStarred });
    }
  }
}
