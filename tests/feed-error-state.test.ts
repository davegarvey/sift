/**
 * Error-state lifecycle: URL edits clear refreshError; sync pulls drop it
 * (it is local-only, never sent or merged).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.stubGlobal('document', {
  addEventListener: () => {},
  visibilityState: 'visible',
});
vi.stubGlobal('window', { addEventListener: () => {} });

import 'fake-indexeddb/auto';
import { getDb } from '../src/db/open';
import { upsertFeed, getFeed } from '../src/db/feeds';
import { changeFeedUrl } from '../src/feeds/service';
import { applyRemoteState } from '../src/sync/apply';
import type { RemotePayload } from '../src/sync/apply';

beforeEach(async () => {
  const db = await getDb();
  await db.clear('feeds');
  await db.clear('items');
  await db.clear('itemFlags');
});

describe('refreshError lifecycle', () => {
  it('editing a feed URL clears its error state', async () => {
    const id = 'feed-id';
    await upsertFeed({
      id,
      url: 'https://old.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: null,
      refreshError: { retryAt: Date.now() + 3_600_000, attempts: 2, lastStatus: 429, lastRetryAfter: 3600 },
    });
    await changeFeedUrl(id, 'https://new.example/feed.xml');
    const feed = (await getFeed(id))!;
    expect(feed.url).toBe('https://new.example/feed.xml');
    expect(feed.refreshError).toBeNull();
  });

  it('a sync pull drops the local refreshError', async () => {
    const id = 'feed-id';
    const now = Date.now();
    await upsertFeed({
      id,
      url: 'https://x.example/feed.xml',
      title: 'X',
      learnedIntervalMs: 3_600_000,
      lastFetched: now - 60_000,
      refreshError: { retryAt: now + 3_600_000, attempts: 3, lastStatus: 429, lastRetryAfter: 3600 },
    });
    const payload: RemotePayload = {
      serverTime: now,
      feeds: [
        {
          feed_id: id,
          feed_url: 'https://x.example/feed.xml',
          feed_url_at: now - 120_000,
          title: 'X',
          title_at: now - 120_000,
          row_at: now - 120_000,
        },
      ],
      flags: [],
    };
    await applyRemoteState(payload);
    const feed = (await getFeed(id))!;
    expect(feed.refreshError).toBeUndefined();
    expect(feed.url).toBe('https://x.example/feed.xml');
  });
});
