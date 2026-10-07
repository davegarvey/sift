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

  it('reports blocked while another tab holds version 9, then upgrading, then idle once the open completes', async () => {
    const olderTab = await openDB(DB_NAME, 9, {
      upgrade(db) {
        db.createObjectStore('feeds', { keyPath: 'id' });
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    const { getDb, getDbStatus, onDbStatusChange } = await freshModule();
    const statuses: string[] = [];
    onDbStatusChange(() => statuses.push(getDbStatus()));
    expect(getDbStatus()).toBe('idle');

    const opening = getDb();
    await vi.waitFor(() => expect(getDbStatus()).toBe('blocked'));

    olderTab.close();
    const db = await opening;

    expect(db.version).toBe(DB_VERSION);
    expect(getDbStatus()).toBe('idle');
    expect(statuses).toEqual(['blocked', 'upgrading', 'idle']);
    db.close();
  });

  it('never reports blocked or upgrading when a new database is created', async () => {
    const { getDb, getDbStatus, onDbStatusChange } = await freshModule();
    const listener = vi.fn();
    onDbStatusChange(listener);
    const db = await getDb();
    expect(getDbStatus()).toBe('idle');
    expect(listener).not.toHaveBeenCalled();
    db.close();
  });

  it('reports upgrading while an existing database is migrated, then idle', async () => {
    const seed = await openDB(DB_NAME, 9, {
      upgrade(db) {
        db.createObjectStore('feeds', { keyPath: 'id' });
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    seed.close();
    const { getDb, getDbStatus, onDbStatusChange } = await freshModule();
    const statuses: string[] = [];
    onDbStatusChange(() => statuses.push(getDbStatus()));

    const db = await getDb();

    expect(statuses).toEqual(['upgrading', 'idle']);
    db.close();
  });

  it('returns to idle when the upgrade fails', async () => {
    const seed = await openDB(DB_NAME, 9, {
      upgrade(db) {
        db.createObjectStore('items', { keyPath: 'id' });
        db.createObjectStore('itemBodies', { keyPath: 'id' });
      },
    });
    seed.close();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getDb, getDbStatus } = await freshModule();

    await expect(getDb()).rejects.toThrow();

    expect(getDbStatus()).toBe('idle');
  });
});
