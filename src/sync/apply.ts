import { upsertFeed, unsubscribeFeed, listFeeds, rekeyFeedId } from '../db/feeds';
import { listItems, updateItem } from '../db/items';
import { bulkSetFlags, getItemFlags, READ_UNREAD, STAR_UNSTARRED, type ItemFlag } from '../db/flags';
import type { Feed, Item } from '../db/types';
import { decodeItemId } from './itemId';
import { rekeyDirtyFeedId } from './queue';

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

/** Local authority time for a feed: the last user-initiated mutation on this device. */
function userMutationTime(f: Feed | undefined): number {
  if (!f) return 0;
  if (f.modifiedAt != null) return f.modifiedAt;
  return Math.max(f.urlAt ?? 0, f.titleAt ?? 0, f.tagsAt ?? 0);
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

export async function canonicalizeLocalFeedIds(remoteFeeds: readonly RemoteFeed[]): Promise<ReadonlyMap<string, string>> {
  const localFeeds = await listFeeds();
  const localById = new Map(localFeeds.map((feed) => [feed.id, feed]));
  const localByUrl = new Map<string, Feed>();
  for (const feed of localFeeds) {
    if (feed.url) localByUrl.set(feed.url, feed);
  }
  const canonicalIdByUrl = new Map<string, string>();
  const canonicalIdByRemoteId = new Map<string, string>();

  for (const remote of remoteFeeds) {
    const canonicalByUrl = remote.feed_url ? canonicalIdByUrl.get(remote.feed_url) : undefined;
    const canonicalId = canonicalByUrl ?? remote.feed_id;
    if (!canonicalByUrl && !localById.has(remote.feed_id) && remote.feed_url) {
      const local = localByUrl.get(remote.feed_url);
      if (local && local.id !== remote.feed_id) {
        const oldId = local.id;
        await rekeyFeedId(oldId, remote.feed_id);
        rekeyDirtyFeedId(oldId, remote.feed_id);
        const rekeyed = { ...local, id: remote.feed_id };
        localById.delete(oldId);
        localById.set(remote.feed_id, rekeyed);
        localByUrl.set(remote.feed_url, rekeyed);
      }
    }
    if (remote.feed_url && !canonicalIdByUrl.has(remote.feed_url)) {
      canonicalIdByUrl.set(remote.feed_url, canonicalId);
    }
    canonicalIdByRemoteId.set(remote.feed_id, canonicalId);
  }
  return canonicalIdByRemoteId;
}

export async function applyRemoteState(
  payload: RemotePayload,
  serverOffset = 0,
  canonicalFeedIds?: ReadonlyMap<string, string>,
): Promise<void> {
  // 1) Feeds.
  const remoteFeedIds = canonicalFeedIds ?? await canonicalizeLocalFeedIds(payload.feeds);
  const localFeeds = await listFeeds();
  const localById = new Map<string, Feed>(localFeeds.map((f) => [f.id, f]));
  const tombstonedForUnsubscribe: string[] = [];
  for (const remoteFeed of payload.feeds) {
    // Convert remote stamps to the local clock frame so every comparison
    // against local stamps (userMutationTime, newer()) is skew-correct.
    const rf = serverOffset === 0
      ? remoteFeed
      : {
          ...remoteFeed,
          feed_url_at: remoteFeed.feed_url_at != null ? remoteFeed.feed_url_at - serverOffset : remoteFeed.feed_url_at,
          folder_at: remoteFeed.folder_at != null ? remoteFeed.folder_at - serverOffset : remoteFeed.folder_at,
          title_at: remoteFeed.title_at != null ? remoteFeed.title_at - serverOffset : remoteFeed.title_at,
          html_url_at: remoteFeed.html_url_at != null ? remoteFeed.html_url_at - serverOffset : remoteFeed.html_url_at,
          tags_at: remoteFeed.tags_at != null ? remoteFeed.tags_at - serverOffset : remoteFeed.tags_at,
          deleted_at: remoteFeed.deleted_at != null ? remoteFeed.deleted_at - serverOffset : remoteFeed.deleted_at,
          row_at: remoteFeed.row_at - serverOffset,
        };
    const localFeedId = remoteFeedIds.get(rf.feed_id) ?? rf.feed_id;
    const local = localById.get(localFeedId);
    const remoteFolder = parseFolder(rf.folder);
    const remoteTags = parseTags(rf.tags);
    const mergedUrl = rf.feed_url != null
      ? newer(rf.feed_url, local?.url ?? null, rf.feed_url_at ?? null, local?.urlAt ?? userMutationTime(local)) ?? rf.feed_url
      : (local?.url ?? '');
    if (!mergedUrl) {
      if (local && rf.deleted === 1 && rf.deleted_at != null && userMutationTime(local) < rf.deleted_at) {
        tombstonedForUnsubscribe.push(localFeedId);
      }
      continue;
    }
    const merged: Feed = {
      id: localFeedId,
      url: mergedUrl,
      title: newer(rf.title ?? null, local?.title ?? null, rf.title_at ?? null, local?.titleAt ?? userMutationTime(local)) ?? '',
      htmlUrl: newer(rf.html_url ?? null, local?.htmlUrl ?? null, rf.html_url_at ?? null, local?.htmlUrlAt ?? null) ?? undefined,
      htmlUrlAt: Math.max(rf.html_url_at ?? 0, local?.htmlUrlAt ?? 0) || null,
      folder: newer(remoteFolder ?? null, local?.folder ?? null, rf.folder_at ?? null, userMutationTime(local)) ?? undefined,
      tags: newer(remoteTags ?? null, local?.tags ?? null, rf.tags_at ?? null, local?.tagsAt ?? null) ?? undefined,
      tagsAt: Math.max(rf.tags_at ?? 0, local?.tagsAt ?? 0) || null,
      titleAt: Math.max(rf.title_at ?? 0, local?.titleAt ?? 0) || null,
      urlAt: Math.max(rf.feed_url_at ?? 0, local?.urlAt ?? 0) || null,
      modifiedAt: local?.modifiedAt ?? null,
      lastFetched: Math.max(local?.lastFetched ?? 0, rf.row_at),
      etag: local?.etag,
      lastModified: local?.lastModified,
      learnedIntervalMs: local?.learnedIntervalMs ?? 60 * 60 * 1000,
      lastError: local?.lastError,
      lastItemPublishedAt: local?.lastItemPublishedAt,
      recentPublishCounts: local?.recentPublishCounts,
    };
    await upsertFeed(merged);
    localById.set(localFeedId, merged);
    if (rf.deleted === 1 && rf.deleted_at != null) {
      const isNewer = !local || userMutationTime(local) < rf.deleted_at;
      if (isNewer) tombstonedForUnsubscribe.push(localFeedId);
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
    const localFeedId = parsed ? remoteFeedIds.get(parsed.feedId) ?? parsed.feedId : rf.feed_id;
    const rawId = parsed ? `${localFeedId}::${parsed.guid}` : rf.item_id;
    const existing: ItemFlag | undefined = flagMap.get(rawId);
    const existingRead = existing ? (existing.read as 0 | 1) : null;
    const existingStarred = existing ? (existing.starred as 0 | 1) : null;
    const mergedRead = newer(rf.read ?? null, existingRead, rf.read_at ?? null, null);
    const mergedStarred = newer(rf.starred ?? null, existingStarred, rf.starred_at ?? null, null);
    const flagRow: ItemFlag = {
      id: rawId,
      feedId: localFeedId,
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
      await updateItem(f.id, { read: targetRead, starred: targetStarred }, { trackReadOnce: false });
    }
  }
}
