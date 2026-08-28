import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db/open';
import { setMeta } from '../src/db/meta';
import {
  loadStatus,
  markError,
  markPullSuccess,
  markPushSuccess,
  lastError,
  lastErrorKind,
  lastErrorAt,
  lastPullAt,
  lastPushAt,
} from '../src/sync/status';

const flushPersist = () => new Promise((r) => setTimeout(r, 250));

beforeEach(async () => {
  const db = await getDb();
  await db.clear('meta');
  await db.clear('feedStats');
  await db.clear('readMarkers');
  await loadStatus();
});

describe('sync status store', () => {
  it('persists an error across reloads', async () => {
    markError('push', new Error('boom'));
    await flushPersist();

    await loadStatus();
    expect(lastError()).toBe('boom');
    expect(lastErrorKind()).toBe('push');
    expect(lastErrorAt()).toBeTypeOf('number');
  });

  it('persists the last push time across reloads', async () => {
    markPushSuccess(1234);
    await flushPersist();

    await loadStatus();
    expect(lastPushAt()).toBe(1234);
  });

  it('does not clear a push error on pull success', async () => {
    markError('push', new Error('push down'));
    markPullSuccess();

    expect(lastError()).toBe('push down');
    expect(lastErrorKind()).toBe('push');

    markPushSuccess(1000);
    expect(lastError()).toBeNull();
    expect(lastErrorKind()).toBeNull();
    expect(lastErrorAt()).toBeNull();
  });

  it('does not clear a pull error on push success', async () => {
    markError('pull', new Error('pull down'));
    markPushSuccess(111);

    expect(lastError()).toBe('pull down');

    markPullSuccess();
    expect(lastError()).toBeNull();
    expect(lastErrorKind()).toBeNull();
  });

  it('loads lastPullAt from the stored pull time', async () => {
    await setMeta('sync_last_pull_at', 777);
    await loadStatus();
    expect(lastPullAt()).toBe(777);
  });
});
