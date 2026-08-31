import { getDb } from './open';
import type { Feed, FeedStats, Item, ReadMarker } from './types';
import type { ItemFlag } from './flags';
import { deleteItemsByFeed } from './items';

export async function upsertFeed(feed: Feed): Promise<void> {
  const db = await getDb();
  await db.put('feeds', feed);
}

export async function getFeed(id: string): Promise<Feed | undefined> {
  const db = await getDb();
  return db.get('feeds', id);
}

export async function getFeedByUrl(url: string): Promise<Feed | undefined> {
  const db = await getDb();
  const feeds = await db.getAllFromIndex('feeds', 'by-url', url);
  return feeds[0];
}

export async function listFeeds(): Promise<Feed[]> {
  const db = await getDb();
  const feeds = await db.getAll('feeds');
  return feeds.sort((a, b) => {
    if (!a.title && !b.title) return 0;
    if (!a.title) return 1;
    if (!b.title) return -1;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });
}

export async function deleteFeed(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('feeds', id);
}

export async function updateFeed(
  id: string,
  patch: Partial<Feed>,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get('feeds', id);
  if (!existing) return;
  await db.put('feeds', { ...existing, ...patch, id });
}

function mergeItems(source: Item, target: Item, id: string, feedId: string): Item {
  const firstOpenedAt = [source.firstOpenedAt, target.firstOpenedAt]
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b)[0] ?? null;
  return {
    ...source,
    ...target,
    id,
    feedId,
    read: source.read || target.read,
    starred: source.starred || target.starred,
    firstOpenedAt,
    createdAt: Math.min(source.createdAt, target.createdAt),
    updatedAt: Math.max(source.updatedAt, target.updatedAt),
  };
}

function mergeFeedStats(source: FeedStats, target: FeedStats, feedId: string): FeedStats {
  return {
    ...source,
    ...target,
    feedId,
    totalSeen: Math.max(source.totalSeen, target.totalSeen),
    readOnce: Math.max(source.readOnce, target.readOnce),
    serverReadOnce: Math.max(source.serverReadOnce, target.serverReadOnce),
  };
}

export async function rekeyFeedId(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  const db = await getDb();
  const tx = db.transaction(['feeds', 'items', 'itemFlags', 'feedStats', 'readMarkers'], 'readwrite');
  const feeds = tx.objectStore('feeds');
  const items = tx.objectStore('items');
  const flags = tx.objectStore('itemFlags');
  const stats = tx.objectStore('feedStats');
  const markers = tx.objectStore('readMarkers');
  const sourceFeed = await feeds.get(fromId);
  if (!sourceFeed) {
    await tx.done;
    return;
  }
  const targetFeed = await feeds.get(toId);
  await feeds.put(targetFeed ? { ...sourceFeed, ...targetFeed, id: toId } : { ...sourceFeed, id: toId });

  const itemRange = IDBKeyRange.bound([fromId, -Infinity], [fromId, Infinity]);
  const sourceItems = await items.index('by-feed-published').getAll(itemRange);
  for (const sourceItem of sourceItems) {
    const targetId = `${toId}::${sourceItem.guid}`;
    const targetItem = await items.get(targetId);
    await items.put(targetItem ? mergeItems(sourceItem, targetItem, targetId, toId) : { ...sourceItem, id: targetId, feedId: toId });
    await items.delete(sourceItem.id);
  }

  const sourceFlags = await flags.index('by-feed-id').getAll(IDBKeyRange.only(fromId));
  for (const sourceFlag of sourceFlags) {
    const targetId = `${toId}::${sourceFlag.id.slice(sourceFlag.id.lastIndexOf('::') + 2)}`;
    const targetFlag = await flags.get(targetId);
    const mergedFlag: ItemFlag = targetFlag
      ? {
          ...targetFlag,
          feedId: toId,
          read: targetFlag.read === 1 || sourceFlag.read === 1 ? 1 : 0,
          starred: targetFlag.starred === 1 || sourceFlag.starred === 1 ? 1 : 0,
        }
      : { ...sourceFlag, id: targetId, feedId: toId };
    await flags.put(mergedFlag);
    await flags.delete(sourceFlag.id);
  }

  const sourceMarkers = await markers.index('by-feed-id').getAll(IDBKeyRange.only(fromId));
  for (const sourceMarker of sourceMarkers) {
    const targetId = `${toId}::${sourceMarker.id.slice(sourceMarker.id.lastIndexOf('::') + 2)}`;
    const targetMarker = await markers.get(targetId);
    const mergedMarker: ReadMarker = targetMarker
      ? { ...targetMarker, feedId: toId, acknowledged: targetMarker.acknowledged === 0 || sourceMarker.acknowledged === 0 ? 0 : 1 }
      : { ...sourceMarker, id: targetId, feedId: toId };
    await markers.put(mergedMarker);
    await markers.delete(sourceMarker.id);
  }

  const sourceStats = await stats.get(fromId);
  if (sourceStats) {
    const targetStats = await stats.get(toId);
    await stats.put(targetStats ? mergeFeedStats(sourceStats, targetStats, toId) : { ...sourceStats, feedId: toId });
    await stats.delete(fromId);
  }

  await feeds.delete(fromId);
  await tx.done;
}

/** Delete a feed and all its items. This cannot be undone. */
export async function unsubscribeFeed(id: string): Promise<void> {
  await deleteItemsByFeed(id);
  await deleteFeed(id);
}
