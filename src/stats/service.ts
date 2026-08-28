import { listFeeds } from '../db/feeds';
import { listFeedStats } from '../db/stats';
import { DEFAULT_STATS_SORT, type Feed, type FeedStats, type StatsSortColumn, type StatsSortDirection, type StatsSortPreference } from '../db/types';

export type StatsSort = StatsSortPreference;
export type { StatsSortColumn, StatsSortDirection };
export { DEFAULT_STATS_SORT };

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

function compareTitles(a: FeedStatsView, b: FeedStatsView): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

function compareNumbers(a: number | null, b: number | null, direction: StatsSortDirection): number {
  if (a == null || b == null) {
    if (a == null && b == null) return 0;
    return a == null ? 1 : -1;
  }
  if (a === b) return 0;
  const comparison = a < b ? -1 : 1;
  return direction === 'asc' ? comparison : -comparison;
}

function numericSortValue(row: FeedStatsView, column: Exclude<StatsSortColumn, 'title'>): number | null {
  switch (column) {
    case 'totalSeen': return row.totalSeen;
    case 'readOnce': return row.readOnce;
    case 'readRate': return row.readRate;
    case 'expectedReads': return row.expectedReads;
    case 'readIndex': return row.readIndex;
  }
}

export function defaultStatsSortDirection(column: StatsSortColumn): StatsSortDirection {
  return column === 'title' ? 'asc' : 'desc';
}

export function sortFeedStats(rows: readonly FeedStatsView[], sort: StatsSort): FeedStatsView[] {
  return [...rows].sort((a, b) => {
    if (sort.column === 'title') {
      const comparison = compareTitles(a, b);
      return sort.direction === 'asc' ? comparison : -comparison;
    }
    const comparison = compareNumbers(numericSortValue(a, sort.column), numericSortValue(b, sort.column), sort.direction);
    return comparison === 0 ? compareTitles(a, b) : comparison;
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
