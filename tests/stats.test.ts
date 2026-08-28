import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/open';
import { upsertFeed } from '../src/db/feeds';
import { upsertFeedStats } from '../src/db/stats';
import { deriveFeedStats, loadStats, overallReadRate, sortFeedStats } from '../src/stats/service';
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

  it('sorts by absolute reads, read rate, or lifetime backlog', () => {
    const rows = [
      deriveFeedStats(feed('low', 'Low'), { totalSeen: 100, readOnce: 10 }, 0.2),
      deriveFeedStats(feed('high', 'High'), { totalSeen: 100, readOnce: 40 }, 0.2),
    ];
    expect(sortFeedStats(rows, 'readOnce').map((row) => row.feedId)).toEqual(['high', 'low']);
    expect(sortFeedStats(rows, 'readRate').map((row) => row.feedId)).toEqual(['high', 'low']);
    expect(sortFeedStats(rows, 'backlog').map((row) => row.feedId)).toEqual(['low', 'high']);
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
