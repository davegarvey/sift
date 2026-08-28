import { listFeeds } from '../db/feeds';
import { listFeedStats } from '../db/stats';
import type { Feed, FeedStats } from '../db/types';

export type StatsSort = 'readOnce' | 'readRate' | 'backlog';

export interface FeedStatsView {
  feedId: string;
  title: string;
  url: string;
  totalSeen: number;
  readOnce: number;
  readRate: number | null;
  expectedReads: number | null;
  readIndex: number | null;
  backlog: number;
}

export interface StatsSummary {
  totalSeen: number;
  readOnce: number;
  readRate: number | null;
  feeds: FeedStatsView[];
}

function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function overallReadRate(rows: readonly Pick<FeedStats, 'totalSeen' | 'readOnce'>[]): number | null {
  const totalSeen = rows.reduce((sum, row) => sum + safeCount(row.totalSeen), 0);
  if (totalSeen === 0) return null;
  const readOnce = rows.reduce((sum, row) => sum + safeCount(row.readOnce), 0);
  return Math.min(1, readOnce / totalSeen);
}

export function deriveFeedStats(
  feed: Pick<Feed, 'id' | 'title' | 'url'>,
  stats: Pick<FeedStats, 'totalSeen' | 'readOnce'>,
  baseline: number | null,
): FeedStatsView {
  const totalSeen = safeCount(stats.totalSeen);
  const readOnce = Math.min(totalSeen, safeCount(stats.readOnce));
  const readRate = totalSeen > 0 ? readOnce / totalSeen : null;
  const expectedReads = baseline == null || totalSeen === 0 ? null : totalSeen * baseline;
  const readIndex = expectedReads != null && expectedReads > 0 ? readOnce / expectedReads : null;
  return {
    feedId: feed.id,
    title: feed.title || feed.url || 'Untitled feed',
    url: feed.url,
    totalSeen,
    readOnce,
    readRate,
    expectedReads,
    readIndex,
    backlog: Math.max(0, totalSeen - readOnce),
  };
}

export function sortFeedStats(rows: readonly FeedStatsView[], sort: StatsSort): FeedStatsView[] {
  return [...rows].sort((a, b) => {
    const av = sort === 'readOnce' ? a.readOnce : sort === 'readRate' ? a.readRate ?? -1 : a.backlog;
    const bv = sort === 'readOnce' ? b.readOnce : sort === 'readRate' ? b.readRate ?? -1 : b.backlog;
    if (bv !== av) return bv - av;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });
}

export async function loadStats(): Promise<StatsSummary> {
  const [feeds, stored] = await Promise.all([listFeeds(), listFeedStats()]);
  const byId = new Map(stored.map((row) => [row.feedId, row]));
  const rows = feeds.map((feed) => {
    const stats = byId.get(feed.id) ?? {
      feedId: feed.id,
      totalSeen: 0,
      readOnce: 0,
      serverReadOnce: 0,
      title: feed.title,
      url: feed.url,
    };
    return { feed, stats };
  });
  const baseline = overallReadRate(rows.map(({ stats }) => stats));
  const viewRows = rows.map(({ feed, stats }) => deriveFeedStats(feed, stats, baseline));
  return {
    totalSeen: rows.reduce((sum, { stats }) => sum + safeCount(stats.totalSeen), 0),
    readOnce: rows.reduce((sum, { stats }) => sum + Math.min(safeCount(stats.totalSeen), safeCount(stats.readOnce)), 0),
    readRate: baseline,
    feeds: viewRows,
  };
}
