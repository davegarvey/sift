import { getDb } from './open';
import type { Feed } from './types';
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
  const feeds = await db.getAll('feeds');
  return feeds.find((f) => f.url === url);
}

export async function listFeeds(): Promise<Feed[]> {
  const db = await getDb();
  return db.getAll('feeds');
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

/** Delete a feed and all its items. This cannot be undone. */
export async function unsubscribeFeed(id: string): Promise<void> {
  await deleteItemsByFeed(id);
  await deleteFeed(id);
}
