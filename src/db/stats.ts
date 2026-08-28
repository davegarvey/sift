import { getDb } from './open';
import type { Feed, FeedStats, ReadMarker } from './types';

export interface RemoteStatsRow {
  feedId: string;
  totalSeen: number;
  readOnce: number;
  feedUrl?: string | null;
  title?: string | null;
}

export interface RemoteReadMarker {
  id: string;
  feedId: string;
}

function validCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function emptyFeedStats(feed: Pick<Feed, 'id' | 'title' | 'url'>): FeedStats {
  return {
    feedId: feed.id,
    totalSeen: 0,
    readOnce: 0,
    serverReadOnce: 0,
    title: feed.title,
    url: feed.url,
  };
}

export async function getFeedStats(feedId: string): Promise<FeedStats | undefined> {
  const db = await getDb();
  return db.get('feedStats', feedId);
}

export async function listFeedStats(): Promise<FeedStats[]> {
  const db = await getDb();
  return db.getAll('feedStats');
}

export async function upsertFeedStats(stats: FeedStats): Promise<void> {
  const db = await getDb();
  await db.put('feedStats', stats);
}

export async function ensureFeedStats(feed: Feed): Promise<FeedStats> {
  const db = await getDb();
  const existing = await db.get('feedStats', feed.id);
  const next = existing
    ? { ...existing, title: feed.title, url: feed.url }
    : emptyFeedStats(feed);
  await db.put('feedStats', next);
  return next;
}

export async function updateFeedStatsLabel(feed: Pick<Feed, 'id' | 'title' | 'url'>): Promise<void> {
  const db = await getDb();
  const existing = await db.get('feedStats', feed.id);
  await db.put('feedStats', {
    ...(existing ?? emptyFeedStats(feed)),
    feedId: feed.id,
    title: feed.title,
    url: feed.url,
  });
}

export async function getReadMarker(id: string): Promise<ReadMarker | undefined> {
  const db = await getDb();
  return db.get('readMarkers', id);
}

export async function listReadMarkers(): Promise<ReadMarker[]> {
  const db = await getDb();
  return db.getAll('readMarkers');
}

export async function listPendingReadMarkers(): Promise<ReadMarker[]> {
  const db = await getDb();
  return db.getAllFromIndex('readMarkers', 'by-acknowledged', IDBKeyRange.only(0));
}

export async function applyRemoteStatistics(
  rows: RemoteStatsRow[],
  markers: RemoteReadMarker[],
  acknowledgedIds: readonly string[] = [],
): Promise<void> {
  if (rows.length === 0 && markers.length === 0 && acknowledgedIds.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(['feedStats', 'readMarkers'], 'readwrite');
  const statsStore = tx.objectStore('feedStats');
  const markersStore = tx.objectStore('readMarkers');

  const feedIds = new Set<string>();
  for (const row of rows) {
    if (!row.feedId) continue;
    feedIds.add(row.feedId);
  }
  for (const marker of markers) {
    if (!marker.id || !marker.feedId) continue;
    feedIds.add(marker.feedId);
    await markersStore.put({
      id: marker.id,
      feedId: marker.feedId,
      acknowledged: 1,
    });
  }
  for (const id of acknowledgedIds) {
    if (!id) continue;
    const existing = await markersStore.get(id);
    if (!existing) continue;
    await markersStore.put({ ...existing, acknowledged: 1 });
    feedIds.add(existing.feedId);
  }

  const rowsByFeed = new Map(rows.filter((row) => row.feedId).map((row) => [row.feedId, row]));
  for (const feedId of feedIds) {
    const existing = await statsStore.get(feedId);
    const row = rowsByFeed.get(feedId);
    const pending = await markersStore.index('by-feed-id').getAll(IDBKeyRange.only(feedId));
    const pendingCount = pending.filter((marker) => marker.acknowledged === 0).length;
    const serverReadOnce = Math.max(existing?.serverReadOnce ?? 0, row ? validCount(row.readOnce) : 0);
    const remoteTotalSeen = row ? validCount(row.totalSeen) : 0;
    const readOnce = Math.max(existing?.readOnce ?? 0, serverReadOnce + pendingCount);
    const totalSeen = Math.max(existing?.totalSeen ?? 0, remoteTotalSeen, readOnce);
    await statsStore.put({
      feedId,
      totalSeen,
      serverReadOnce,
      readOnce,
      title: row?.title ?? existing?.title ?? '',
      url: row?.feedUrl ?? existing?.url ?? '',
    });
  }
  await tx.done;
}
