import { getDb } from './open';

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const row = await db.get('meta', key);
  return (row?.value as T) ?? fallback;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put('meta', { key, value });
}