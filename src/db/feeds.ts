import { getDb } from './open';
import type { Feed } from './types';

export async function upsertFeed(feed: Feed): Promise<void> {
  const db = await getDb();
  await db.put('feeds', feed);
}

export async function getFeedByUrl(url: string): Promise<Feed | undefined> {
  const db = await getDb();
  return db.get('feeds', url);
}

export async function listFeeds(): Promise<Feed[]> {
  const db = await getDb();
  return db.getAll('feeds');
}

export async function deleteFeed(url: string): Promise<void> {
  const db = await getDb();
  await db.delete('feeds', url);
}

export async function updateFeed(
  url: string,
  patch: Partial<Feed>,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get('feeds', url);
  if (!existing) return;
  await db.put('feeds', { ...existing, ...patch, url });
}