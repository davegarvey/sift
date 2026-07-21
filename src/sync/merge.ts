import { listFeeds, upsertFeed, unsubscribeFeed } from '../db/feeds';
import { listItems } from '../db/items';
import { getItemFlags, bulkSetFlags } from '../db/flags';
import { enqueueFeed, enqueueFlag } from './queue';
import { flushNow, scheduleFlush } from './push';
import { pullSince, type PullPayload } from './client';
import { applyRemoteState, type RemotePayload, type RemoteFeed, type RemoteFlag } from './apply';
import { getStoredLastSyncAt, setStoredLastSyncAt } from './key';
import type { Feed, Item } from '../db/types';
import type { ItemFlag } from '../db/flags';

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

async function pushLocalState(feeds: Feed[], flags: ItemFlag[]): Promise<void> {
  const now = Date.now();
  for (const feed of feeds) {
    if (!feed.url) continue;
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
  const lastSyncAt = await getStoredLastSyncAt();

  if (lastSyncAt == null) {
    await pushLocalState(existingFeeds, existingFlags);
    const pull = await pullSince(0);
    const payload = toRemotePayload(pull);
    await mergePayload(payload, pull.serverTime);
    return (await getStoredLastSyncAt()) ?? 0;
  }

  const pull = await pullSince(lastSyncAt);
  const payload = toRemotePayload(pull);

  if (payload.feeds.length === 0 && payload.flags.length === 0 && existingFeeds.length > 0) {
    await pushLocalState(existingFeeds, existingFlags);
    const pull2 = await pullSince(0);
    const payload2 = toRemotePayload(pull2);
    await mergePayload(payload2, pull2.serverTime);
    return (await getStoredLastSyncAt()) ?? 0;
  }

  await mergePayload(payload, pull.serverTime);
  return (await getStoredLastSyncAt()) ?? 0;
}

export async function runPull(): Promise<number | null> {
  const since = (await getStoredLastSyncAt()) ?? 0;
  const pull = await pullSince(since);
  const payload = toRemotePayload(pull);
  if (payload.feeds.length === 0 && payload.flags.length === 0) {
    await setStoredLastSyncAt(Math.max(since, pull.serverTime));
    return pull.serverTime;
  }
  await applyRemoteState(payload);
  const newTime = Math.max(since, pull.serverTime);
  await setStoredLastSyncAt(newTime);
  scheduleFlush();
  onSync?.();
  return newTime;
}
