export interface StatsFeedInput {
  feed_id: string;
  feed_url: string | null;
  title: string | null;
  deleted: number;
}

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
}

export interface StatsOutput {
  source: 'sync';
  approximate: true;
  summary: StatsSummary;
  feeds: FeedStatsView[];
}

interface AggregateStats {
  feedId: string;
  totalSeen: number;
  readOnce: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function parseAggregate(value: unknown): AggregateStats | null {
  if (!isRecord(value) || typeof value.feed_id !== 'string' || value.feed_id.length === 0) return null;
  return {
    feedId: value.feed_id,
    totalSeen: safeCount(value.total_seen),
    readOnce: safeCount(value.read_once),
  };
}

function liveFeeds(rows: readonly StatsFeedInput[]): StatsFeedInput[] {
  const seenUrls = new Set<string>();
  const result: StatsFeedInput[] = [];
  for (const row of rows) {
    if (row.deleted === 1 || !row.feed_id || !row.feed_url || seenUrls.has(row.feed_url)) continue;
    seenUrls.add(row.feed_url);
    result.push(row);
  }
  return result;
}

export function overallReadRate(rows: readonly Pick<FeedStatsView, 'totalSeen' | 'readOnce'>[]): number | null {
  const totalSeen = rows.reduce((sum, row) => sum + safeCount(row.totalSeen), 0);
  if (totalSeen === 0) return null;
  const readOnce = rows.reduce((sum, row) => sum + Math.min(safeCount(row.totalSeen), safeCount(row.readOnce)), 0);
  return Math.min(1, readOnce / totalSeen);
}

export function deriveFeedStats(
  feed: Pick<StatsFeedInput, 'feed_id' | 'feed_url' | 'title'>,
  stats: Pick<AggregateStats, 'totalSeen' | 'readOnce'>,
  baseline: number | null,
): FeedStatsView {
  const totalSeen = safeCount(stats.totalSeen);
  const readOnce = Math.min(totalSeen, safeCount(stats.readOnce));
  const readRate = totalSeen > 0 ? readOnce / totalSeen : null;
  const expectedReads = baseline == null || totalSeen === 0 ? null : totalSeen * baseline;
  const readIndex = expectedReads != null && expectedReads > 0 ? readOnce / expectedReads : null;
  const url = feed.feed_url ?? '';
  return {
    feedId: feed.feed_id,
    title: feed.title || url || 'Untitled feed',
    url,
    totalSeen,
    readOnce,
    readRate,
    expectedReads,
    readIndex,
    backlog: Math.max(0, totalSeen - readOnce),
  };
}

export function sortStatsRows(rows: readonly FeedStatsView[]): FeedStatsView[] {
  return [...rows].sort((a, b) => {
    if (a.readOnce !== b.readOnce) return b.readOnce - a.readOnce;
    const titleComparison = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    return titleComparison === 0 ? a.feedId.localeCompare(b.feedId) : titleComparison;
  });
}

export function buildStats(feedRows: readonly StatsFeedInput[], rawStats: readonly unknown[]): StatsOutput {
  const feeds = liveFeeds(feedRows);
  const statsByFeed = new Map<string, AggregateStats>();
  for (const rawRow of rawStats) {
    const parsed = parseAggregate(rawRow);
    if (!parsed) continue;
    const existing = statsByFeed.get(parsed.feedId);
    if (!existing) {
      statsByFeed.set(parsed.feedId, parsed);
      continue;
    }
    existing.totalSeen = Math.max(existing.totalSeen, parsed.totalSeen);
    existing.readOnce = Math.max(existing.readOnce, parsed.readOnce);
  }

  const inputRows = feeds.map((feed) => statsByFeed.get(feed.feed_id) ?? { feedId: feed.feed_id, totalSeen: 0, readOnce: 0 });
  const baseline = overallReadRate(inputRows.map((stats) => ({ totalSeen: stats.totalSeen, readOnce: stats.readOnce })));
  const rows = sortStatsRows(feeds.map((feed, index) => deriveFeedStats(feed, inputRows[index], baseline)));
  const totalSeen = rows.reduce((sum, row) => sum + row.totalSeen, 0);
  const readOnce = rows.reduce((sum, row) => sum + row.readOnce, 0);
  return {
    source: 'sync',
    approximate: true,
    summary: {
      totalSeen,
      readOnce,
      readRate: baseline,
    },
    feeds: rows,
  };
}
