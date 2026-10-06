import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB } from 'idb';
import { DB_NAME, DB_VERSION } from '../src/db/types';

async function freshModule() {
  vi.resetModules();
  return import('../src/db/open');
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tab coordination', () => {
  it('closes the connection and reloads when a newer version needs to upgrade', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const { getDb } = await freshModule();
    await getDb();

    const newer = await openDB(DB_NAME, DB_VERSION + 1);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(newer.version).toBe(DB_VERSION + 1);
    newer.close();
  });

  it('releases the connection before reloading', async () => {
    const { releaseForUpgrade } = await freshModule();
    const order: string[] = [];
    releaseForUpgrade({ close: () => order.push('close') }, () => order.push('reload'));
    expect(order).toEqual(['close', 'reload']);
  });

  it('reports a blocked open while another tab holds version 9, and clears it once the open completes', async () => {
    const olderTab = await openDB(DB_NAME, 9, {
      upgrade(db) {
        db.createObjectStore('feeds', { keyPath: 'id' });
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    const { getDb, isDbBlocked, onDbBlockedChange } = await freshModule();
    const changes: boolean[] = [];
    onDbBlockedChange(() => changes.push(isDbBlocked()));
    expect(isDbBlocked()).toBe(false);

    const opening = getDb();
    await vi.waitFor(() => expect(isDbBlocked()).toBe(true));

    olderTab.close();
    const db = await opening;

    expect(db.version).toBe(DB_VERSION);
    expect(isDbBlocked()).toBe(false);
    expect(changes).toEqual([true, false]);
    db.close();
  });

  it('never reports blocked when nothing holds the database open', async () => {
    const { getDb, isDbBlocked, onDbBlockedChange } = await freshModule();
    const listener = vi.fn();
    onDbBlockedChange(listener);
    const db = await getDb();
    expect(isDbBlocked()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    db.close();
  });
});
