import { listFeeds, upsertFeed, unsubscribeFeed } from '../db/feeds';
import { listItems } from '../db/items';
import { getItemFlags, bulkSetFlags } from '../db/flags';
import { enqueueFeed, enqueueFlag } from './queue';
import { flushNow, scheduleFlush } from './push';
import { pullSince, type PullPayload } from './client';
import { applyRemoteState, type RemotePayload, type RemoteFeed, type RemoteFlag } from './apply';
import { getStoredLastSyncAt, setStoredLastSyncAt } from './key';
import type { Feed, Item } from '../db/types';

let onSync: (() => void) | null = null;

export function setOnSync(fn: (() => void) | null): void {
  onSync = fn;
}

function toRemotePayload(p: PullPayload): RemotePayload {
  return {
    serverTime: p.serverTime,
    feeds: p.feeds as unknown as RemoteFeed[],
    flags: p.flags as unknown as RemoteFlag[],
  };
}

function snapshotFeeds(): Feed[] {
  return []; // placeholder — caller provides via async wrapper
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

export async function runFirstTimeSetup(): Promise<number> {
  const existingFeeds = await listFeeds();
  const existingFlags = await getItemFlags();
  const now = Date.now();
  for (const feed of existingFeeds) {
    enqueueFeed({
      feedId: feed.id,
      folder: feed.folder ?? null,
      folderAt: now,
      title: feed.title,
      titleAt: now,
      feedUrl: null,
      tags: feed.tags ?? null,
      tagsAt: now,
      deleted: 0,
      deletedAt: now,
    });
  }
  for (const flag of existingFlags) {
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

  const pull = await pullSince(0);
  const payload = toRemotePayload(pull);

  const snap = await snapshotLocal();

  await mergeForFirstTime(snap, payload);

  await flushNow();

  const newTime = Math.max(await getStoredLastSyncAt() ?? 0, pull.serverTime);
  await setStoredLastSyncAt(newTime);

  return newTime;
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
