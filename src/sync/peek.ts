import { DB_NAME } from '../db/types';
import { isValidSyncKey } from './key';

function openExisting(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function peekStoredSyncKey(): Promise<string | null> {
  const db = await openExisting();
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains('meta')) return null;
    return await new Promise<string | null>((resolve) => {
      const request = db.transaction('meta', 'readonly').objectStore('meta').get('settings');
      request.onsuccess = () => {
        const value = (request.result as { value?: { syncKey?: unknown } } | undefined)?.value;
        const key = value?.syncKey;
        resolve(typeof key === 'string' && isValidSyncKey(key) ? key : null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}
