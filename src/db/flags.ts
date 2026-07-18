import { getDb } from './open';

export const READ_UNREAD = 0;
export const READ_READ = 1;
export const STAR_UNSTARRED = 0;
export const STAR_STARRED = 1;

export interface ItemFlag {
  id: string;
  feedId: string;
  read: 0 | 1;
  starred: 0 | 1;
}

export function readToFlag(b: boolean): 0 | 1 {
  return b ? READ_READ : READ_UNREAD;
}

export function flagToRead(n: number): boolean {
  return n === READ_READ;
}

export function starToFlag(b: boolean): 0 | 1 {
  return b ? STAR_STARRED : STAR_UNSTARRED;
}

export function flagToStar(n: number): boolean {
  return n === STAR_STARRED;
}

export async function getFlag(id: string): Promise<ItemFlag | undefined> {
  const db = await getDb();
  return db.get('itemFlags', id);
}

export async function getItemFlags(): Promise<ItemFlag[]> {
  const db = await getDb();
  return db.getAll('itemFlags');
}

export async function setFlag(flag: ItemFlag): Promise<void> {
  const db = await getDb();
  await db.put('itemFlags', flag);
}

export async function bulkSetFlags(flags: ItemFlag[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('itemFlags', 'readwrite');
  for (const flag of flags) {
    await tx.store.put(flag);
  }
  await tx.done;
}

export async function deleteFlagsByFeed(feedId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('itemFlags', 'readwrite');
  let cursor = await tx.store
    .index('by-feed-id')
    .openCursor(IDBKeyRange.only(feedId));
  while (cursor) {
    cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}
