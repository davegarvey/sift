import { upsertFeed, getFeedByUrl, unsubscribeFeed, listFeeds } from '../db/feeds';
import { getItem, listItems, bulkUpsertItems, updateItem } from '../db/items';
import { bulkSetFlags, getItemFlags, READ_UNREAD, READ_READ, STAR_UNSTARRED, STAR_STARRED, type ItemFlag } from '../db/flags';
import type { Feed, Item } from '../db/types';
import { decodeItemId, encodeItemId } from './itemId';

export interface RemoteFeed {
  feed_id: string;
  feed_url?: string | null;
  feed_url_at?: number | null;
  html_url?: string | null;
  html_url_at?: number | null;
  folder?: string | null;
  folder_at?: number | null;
  title?: string | null;
  title_at?: number | null;
  tags?: string | null;
  tags_at?: number | null;
  deleted?: 0 | 1;
  deleted_at?: number | null;
  row_at: number;
}

export interface RemoteFlag {
  item_id: string;
  feed_id: string;
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

function parseTags(s: string | null | undefined): string[] | undefined {
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
  const localById = new Map<string, Feed>(localFeeds.map((f) => [f.id, f]));
  const localByUrl = new Map<string, Feed>();
  for (const f of localFeeds) {
    if (f.url) localByUrl.set(f.url, f);
  }
  const tombstonedForUnsubscribe: string[] = [];
  for (let rf of payload.feeds) {
    let local = localById.get(rf.feed_id);

    // Deduplicate by URL: if the remote feed matches a local feed by URL
    // but has a different ID (e.g. two devices subscribed to the same feed
    // before pairing), merge into the local feed instead of creating a
    // duplicate.
    if (!local && rf.feed_url) {
      const dup = localByUrl.get(rf.feed_url);
      if (dup && dup.id !== rf.feed_id) {
        rf = { ...rf, feed_id: dup.id };
        local = dup;
      }
    }
    const remoteFolder = parseFolder(rf.folder);
    const remoteTags = parseTags(rf.tags);
    const mergedUrl = rf.feed_url != null
      ? newer(rf.feed_url, local?.url ?? null, rf.feed_url_at ?? null, local?.urlAt ?? local?.lastFetched ?? null) ?? rf.feed_url
      : (local?.url ?? '');
    if (!mergedUrl) {
      if (local && rf.deleted === 1 && rf.deleted_at != null && (local.lastFetched ?? 0) < rf.deleted_at) {
        tombstonedForUnsubscribe.push(rf.feed_id);
      }
      continue;
    }
    const merged: Feed = {
      id: rf.feed_id,
      url: mergedUrl,
      title: newer(rf.title ?? null, local?.title ?? null, rf.title_at ?? null, local?.titleAt ?? local?.lastFetched ?? null) ?? '',
      htmlUrl: newer(rf.html_url ?? null, local?.htmlUrl ?? null, rf.html_url_at ?? null, local?.htmlUrlAt ?? null) ?? undefined,
      htmlUrlAt: Math.max(rf.html_url_at ?? 0, local?.htmlUrlAt ?? 0) || null,
      folder: newer(remoteFolder ?? null, local?.folder ?? null, rf.folder_at ?? null, local?.lastFetched ?? null) ?? undefined,
      tags: newer(remoteTags ?? null, local?.tags ?? null, rf.tags_at ?? null, local?.tagsAt ?? null) ?? undefined,
      tagsAt: Math.max(rf.tags_at ?? 0, local?.tagsAt ?? 0) || null,
      titleAt: Math.max(rf.title_at ?? 0, local?.titleAt ?? 0) || null,
      urlAt: Math.max(rf.feed_url_at ?? 0, local?.urlAt ?? 0) || null,
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
      if (isNewer) tombstonedForUnsubscribe.push(rf.feed_id);
    }
  }
  for (const id of tombstonedForUnsubscribe) {
    await unsubscribeFeed(id);
  }

  // 2) Flags.
  const localItems = await listItems();
  const localByIdMap = new Map<string, Item>(localItems.map((it) => [it.id, it]));
  const existingFlags = await getItemFlags();
  const flagMap = new Map(existingFlags.map((f) => [f.id, f]));

  for (const rf of payload.flags) {
    const parsed = decodeItemId(rf.item_id);
    const rawId = parsed ? `${parsed.feedId}::${parsed.guid}` : rf.item_id;
    const existing: ItemFlag | undefined = flagMap.get(rawId);
    const existingRead = existing ? (existing.read as 0 | 1) : null;
    const existingStarred = existing ? (existing.starred as 0 | 1) : null;
    const mergedRead = newer(rf.read ?? null, existingRead, rf.read_at ?? null, null);
    const mergedStarred = newer(rf.starred ?? null, existingStarred, rf.starred_at ?? null, null);
    const flagRow: ItemFlag = {
      id: rawId,
      feedId: rf.feed_id,
      read: mergedRead === null ? READ_UNREAD : (mergedRead as 0 | 1),
      starred: mergedStarred === null ? STAR_UNSTARRED : (mergedStarred as 0 | 1),
    };
    flagMap.set(rawId, flagRow);
  }
  await bulkSetFlags(Array.from(flagMap.values()));

  for (const f of flagMap.values()) {
    const localItem = localByIdMap.get(f.id);
    if (!localItem) continue;
    const targetRead = f.read === 1;
    const targetStarred = f.starred === 1;
    if (localItem.read !== targetRead || localItem.starred !== targetStarred) {
      await updateItem(f.id, { read: targetRead, starred: targetStarred });
    }
  }
}
