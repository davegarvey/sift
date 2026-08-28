import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/open';
import { upsertFeed } from '../src/db/feeds';
import { upsertFeedStats } from '../src/db/stats';
import { DEFAULT_STATS_SORT, deriveFeedStats, loadStats, overallReadRate, sortFeedStats } from '../src/stats/service';
import type { Feed } from '../src/db/types';

function feed(id: string, title = id): Feed {
  return {
    id,
    url: `https://${id}.example/feed.xml`,
    title,
    learnedIntervalMs: 3_600_000,
    lastFetched: null,
  };
}

beforeEach(async () => {
  const db = await getDb();
  await db.clear('feeds');
  await db.clear('feedStats');
  await db.clear('readMarkers');
  await db.clear('items');
  await db.clear('itemFlags');
  await db.clear('meta');
});

describe('stats metrics', () => {
  it('derives transparent relative metrics', () => {
    const rows = [
      deriveFeedStats(feed('a'), { totalSeen: 100, readOnce: 20 }, 0.2),
      deriveFeedStats(feed('b'), { totalSeen: 50, readOnce: 15 }, 0.2),
    ];
    expect(rows[0].readRate).toBe(0.2);
    expect(rows[0].expectedReads).toBe(20);
    expect(rows[0].readIndex).toBe(1);
    expect(rows[0].backlog).toBe(80);
    expect(overallReadRate([{ totalSeen: 100, readOnce: 20 }, { totalSeen: 50, readOnce: 15 }])).toBe(0.23333333333333334);
    expect(deriveFeedStats(feed('empty'), { totalSeen: 0, readOnce: 0 }, null).readRate).toBeNull();
  });

  it('sorts by each visible column in both directions', () => {
    const rows = [
      deriveFeedStats(feed('low', 'Low'), { totalSeen: 50, readOnce: 10 }, 0.2),
      deriveFeedStats(feed('high', 'High'), { totalSeen: 100, readOnce: 40 }, 0.2),
    ];
    expect(DEFAULT_STATS_SORT).toEqual({ column: 'readOnce', direction: 'desc' });
    expect(sortFeedStats(rows, DEFAULT_STATS_SORT).map((row) => row.feedId)).toEqual(['high', 'low']);
    expect(sortFeedStats(rows, { column: 'title', direction: 'asc' }).map((row) => row.feedId)).toEqual(['high', 'low']);
    expect(sortFeedStats(rows, { column: 'title', direction: 'desc' }).map((row) => row.feedId)).toEqual(['low', 'high']);
    expect(sortFeedStats(rows, { column: 'totalSeen', direction: 'desc' }).map((row) => row.feedId)).toEqual(['high', 'low']);
    expect(sortFeedStats(rows, { column: 'totalSeen', direction: 'asc' }).map((row) => row.feedId)).toEqual(['low', 'high']);
    expect(sortFeedStats(rows, { column: 'readOnce', direction: 'asc' }).map((row) => row.feedId)).toEqual(['low', 'high']);
    expect(sortFeedStats(rows, { column: 'readRate', direction: 'desc' }).map((row) => row.feedId)).toEqual(['high', 'low']);
    expect(sortFeedStats(rows, { column: 'readRate', direction: 'asc' }).map((row) => row.feedId)).toEqual(['low', 'high']);
    expect(sortFeedStats(rows, { column: 'expectedReads', direction: 'desc' }).map((row) => row.feedId)).toEqual(['high', 'low']);
    expect(sortFeedStats(rows, { column: 'readIndex', direction: 'desc' }).map((row) => row.feedId)).toEqual(['high', 'low']);
  });

  it('keeps unavailable derived values after numeric values', () => {
    const rows = [
      deriveFeedStats(feed('empty', 'Empty'), { totalSeen: 0, readOnce: 0 }, 0.2),
      deriveFeedStats(feed('read', 'Read'), { totalSeen: 10, readOnce: 2 }, 0.2),
      deriveFeedStats(feed('unread', 'Unread'), { totalSeen: 10, readOnce: 0 }, 0.2),
    ];
    expect(sortFeedStats(rows, { column: 'readRate', direction: 'asc' }).map((row) => row.feedId)).toEqual(['unread', 'read', 'empty']);
    expect(sortFeedStats(rows, { column: 'readRate', direction: 'desc' }).map((row) => row.feedId)).toEqual(['read', 'unread', 'empty']);
    expect(sortFeedStats(rows, { column: 'expectedReads', direction: 'asc' }).map((row) => row.feedId)).toEqual(['read', 'unread', 'empty']);
    expect(sortFeedStats(rows, { column: 'readIndex', direction: 'desc' }).map((row) => row.feedId)).toEqual(['read', 'unread', 'empty']);
  });

  it('uses feed title to break equal numeric values', () => {
    const rows = [
      deriveFeedStats(feed('z', 'Zulu'), { totalSeen: 10, readOnce: 2 }, 0.2),
      deriveFeedStats(feed('a', 'Alpha'), { totalSeen: 10, readOnce: 2 }, 0.2),
    ];
    expect(sortFeedStats(rows, { column: 'readOnce', direction: 'desc' }).map((row) => row.feedId)).toEqual(['a', 'z']);
    expect(sortFeedStats(rows, { column: 'readOnce', direction: 'asc' }).map((row) => row.feedId)).toEqual(['a', 'z']);
  });
});

describe('loadStats', () => {
  it('uses every current subscription rather than the river scope', async () => {
    const first = feed('first', 'First');
    const second = feed('second', 'Second');
    await upsertFeed(first);
    await upsertFeed(second);
    await upsertFeedStats({
      feedId: first.id,
      totalSeen: 100,
      readOnce: 20,
      serverReadOnce: 0,
      title: first.title,
      url: first.url,
    });
    await upsertFeedStats({
      feedId: second.id,
      totalSeen: 50,
      readOnce: 25,
      serverReadOnce: 0,
      title: second.title,
      url: second.url,
    });
    const summary = await loadStats();
    expect(summary.totalSeen).toBe(150);
    expect(summary.readOnce).toBe(45);
    expect(summary.feeds.map((row) => row.feedId)).toEqual(['first', 'second']);
    expect(summary.readRate).toBe(0.3);
  });
});
