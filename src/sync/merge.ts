/**
 * First-time setup merge. Used when a device enables sync and has local state.
 *
 * Order: snapshot local → push snapshot → pull since=0 → merge in memory
 * → apply → re-push merged view.
 *
 * The dirty-set entries accumulated during the merge are NOT cleared by
 * the merge itself; they are pushed separately by the normal debounced
 * flusher. PATCH semantics make any duplication idempotent.
 */

import { listFeeds, upsertFeed, unsubscribeFeed } from '../db/feeds';
import { listItems } from '../db/items';
import { getItemFlags, bulkSetFlags } from '../db/flags';
import { enqueueFeed, enqueueFlag } from './queue';
import { flushNow, scheduleFlush } from './push';
import { pullSince, type PullPayload } from './client';
import { applyRemoteState, type RemotePayload, type RemoteFeed, type RemoteFlag } from './apply';
import { getStoredLastSyncAt, setStoredLastSyncAt } from './key';
import type { Feed, Item } from '../db/types';

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

/**
 * Apply a remote pull to the local DB and return the new serverTime
 * (which the caller should set as lastSyncAt).
 */
export async function mergeForFirstTime(_snapshot: LocalSnapshot, payload: RemotePayload): Promise<void> {
  await applyRemoteState(payload);
}

/**
 * The full first-time setup flow. Returns the new serverTime.
 */
export async function runFirstTimeSetup(): Promise<number> {
  // 0) Enqueue existing local state so the first flush pushes it to the server.
  const existingFeeds = await listFeeds();
  const existingFlags = await getItemFlags();
  const now = Date.now();
  for (const feed of existingFeeds) {
    enqueueFeed({
      feedUrl: feed.url,
      folder: feed.folder ?? null,
      folderAt: now,
      title: feed.title,
      titleAt: now,
      deleted: 0,
      deletedAt: now,
    });
  }
  for (const flag of existingFlags) {
    enqueueFlag({
      itemId: flag.id,
      feedUrl: flag.feedUrl,
      read: flag.read,
      readAt: now,
      starred: flag.starred,
      starredAt: now,
    });
  }

  // 1) Push current local state (includes existing feeds + flags now).
  await flushNow();

  // 2) Pull everything.
  const pull = await pullSince(0);
  const payload = toRemotePayload(pull);

  // 3) Snapshot before applying.
  const snap = await snapshotLocal();

  // 4) Merge & apply.
  await mergeForFirstTime(snap, payload);

  // 5) Re-push to converge (mostly a no-op due to PATCH idempotency).
  await flushNow();

  // 6) Update lastSyncAt.
  const newTime = Math.max(await getStoredLastSyncAt() ?? 0, pull.serverTime);
  await setStoredLastSyncAt(newTime);

  return newTime;
}

/**
 * Normal pull + apply. Used on app boot (after first-time setup), focus,
 * online events, and manual "Sync now" clicks.
 */
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
  return newTime;
}
