import { getDb } from '../db/open';
import type { Item } from '../db/types';
import { STORAGE_SOFT_CAP_RATIO, EVICTION_CHUNK_SIZE } from '../db/types';

export async function runEviction(): Promise<void> {
  if (!('storage' in navigator && 'estimate' in navigator.storage)) return;

  const { quota, usage } = await navigator.storage.estimate();
  if (!quota || !usage) return;

  const pctCap = quota * STORAGE_SOFT_CAP_RATIO;
  const halfCap = quota * 0.5;
  const softCap = Math.min(pctCap, halfCap);
  if (usage <= softCap) return;

  const db = await getDb();
  const candidates: Item[] = [];
  let cursor = await db
    .transaction('items', 'readonly')
    .store.index('by-published')
    .openCursor(null, 'prev');
  while (cursor) {
    if (cursor.value.extractedHtml != null) {
      candidates.push(cursor.value);
    }
    cursor = await cursor.continue();
  }

  candidates.sort((a, b) => {
    const aTime = a.firstOpenedAt ?? +Infinity;
    const bTime = b.firstOpenedAt ?? +Infinity;
    return aTime - bTime;
  });

  let bytesToFree = usage - softCap;
  for (let i = 0; i < candidates.length && bytesToFree > 0; i += EVICTION_CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + EVICTION_CHUNK_SIZE);
    const tx = db.transaction('items', 'readwrite');
    for (const item of chunk) {
      if (item.extractedHtml == null) continue;
      bytesToFree -= item.extractedHtml.length;
      await tx.store.put({ ...item, extractedHtml: null, id: item.id });
    }
    await tx.done;
  }
}
