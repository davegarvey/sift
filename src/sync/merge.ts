import { listFeeds, upsertFeed, unsubscribeFeed } from '../db/feeds';
import { listItems } from '../db/items';
import { getItemFlags, bulkSetFlags, type ItemFlag } from '../db/flags';
import { enqueueFeed, enqueueFlag, clearAllDirty } from './queue';
import { flushNow, scheduleFlush } from './push';
import { pullSince, type PullPayload } from './client';
import { applyRemoteState, type RemotePayload, type RemoteFeed, type RemoteFlag } from './apply';
import { getStoredLastSyncAt, setStoredLastSyncAt } from './key';
import { decodeItemId } from './itemId';
import { markPullSuccess, markError } from './status';
import type { Feed, Item } from '../db/types';

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

export async function mergeForFirstTime(_snapshot: LocalSnapshot, payload: RemotePayload): Promise<void> {
  await applyRemoteState(payload);
  onSync?.();
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

async function mergePayload(payload: RemotePayload, serverTime: number): Promise<void> {
  const snap = await snapshotLocal();
  await mergeForFirstTime(snap, payload);
  await flushNow();
  const newTime = Math.max(await getStoredLastSyncAt() ?? 0, serverTime);
  await setStoredLastSyncAt(newTime);
}

export async function runFirstTimeSetup(): Promise<number> {
  const existingFeeds = await listFeeds();
  const existingFlags = await getItemFlags();

  // Start clean: any dirty entries from a previous partial setup, or from
  // changes made while sync was disabled, are superseded by the diff below
  // (the diff is computed from local DB state, not from the dirty queue).
  await clearAllDirty();

  try {
    const pull = await pullSince(0);
    const payload = toRemotePayload(pull);
    await pushLocalDiff(existingFeeds, existingFlags, payload.feeds, payload.flags);
    await mergePayload(payload, pull.serverTime);
  } catch (e) {
    markError('pull', e);
    throw e;
  }
  const cursor = (await getStoredLastSyncAt()) ?? 0;
  markPullSuccess(cursor);
  return cursor;
}

export async function runPull(): Promise<number | null> {
  const since = (await getStoredLastSyncAt()) ?? 0;
  try {
    const pull = await pullSince(since);
    const payload = toRemotePayload(pull);
    if (payload.feeds.length === 0 && payload.flags.length === 0) {
      await setStoredLastSyncAt(Math.max(since, pull.serverTime));
      markPullSuccess(pull.serverTime);
      return pull.serverTime;
    }
    await applyRemoteState(payload);
    const newTime = Math.max(since, pull.serverTime);
    await setStoredLastSyncAt(newTime);
    markPullSuccess(newTime);
    scheduleFlush();
    onSync?.();
    return newTime;
  } catch (e) {
    markError('pull', e);
    throw e;
  }
}
