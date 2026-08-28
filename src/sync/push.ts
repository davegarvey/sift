import { pushChunk, pushStatsChunk, SyncClientError, MAX_DIRTY_PER_PUSH } from './client';
import { getDirty, clearEntries, type DirtyEntry } from './queue';
import { decodeItemId, encodeItemId } from './itemId';
import { markPushSuccess, markError, refreshPending } from './status';
import { getStoredSyncKey } from './key';
import { isStatsSyncAvailable } from './capabilities';
import { applyRemoteStatistics, type RemoteStatsRow } from '../db/stats';

const DEBOUNCE_MS = 1000;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

function splitChunk<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return [items];
  const mid = Math.floor(items.length / 2);
  return [...splitChunk(items.slice(0, mid), size), ...splitChunk(items.slice(mid), size)];
}

function chunkToBody(chunk: DirtyEntry[]): { feeds?: unknown[]; flags?: unknown[] } {
  // Deduplicate flag-update entries: keep only the last entry per itemId.
  const seen = new Map<string, DirtyEntry & { kind: 'flag-update' }>();
  const deduped: DirtyEntry[] = [];
  for (const e of chunk) {
    if (e.kind === 'flag-update') {
      const prev = seen.get(e.itemId);
      if (prev) {
        const idx = deduped.indexOf(prev);
        deduped.splice(idx, 1);
      }
      seen.set(e.itemId, e);
      deduped.push(e);
    } else {
      deduped.push(e);
    }
  }
  // Bare field values only — the server stamps every write with its own
  // monotonic time. No client timestamps exist on the wire.
  const feeds: unknown[] = [];
  const flags: unknown[] = [];
  for (const e of deduped) {
    if (e.kind === 'feed-upsert') {
      const feedPayload: Record<string, unknown> = { feedId: e.feedId };
      if (e.folder !== null) feedPayload.folder = e.folder;
      if (e.title !== null) feedPayload.title = e.title;
      if (e.feedUrl !== null) feedPayload.feedUrl = e.feedUrl.value;
      if (e.htmlUrl !== null) feedPayload.htmlUrl = e.htmlUrl.value;
      if (e.tags !== null) feedPayload.tags = e.tags;
      if (e.deleted !== null) feedPayload.deleted = e.deleted;
      feeds.push(feedPayload);
    } else if (e.kind === 'feed-delete') {
      const feedPayload: Record<string, unknown> = { feedId: e.feedId };
      feedPayload.feedUrl = e.feedUrl.value;
      feedPayload.deleted = 1;
      feeds.push(feedPayload);
    } else if (e.kind === 'flag-update') {
      const lastSep = e.itemId.lastIndexOf('::');
      const feedId = e.feedId;
      const guid = lastSep >= 0 ? e.itemId.slice(lastSep + 2) : e.itemId;
      const itemId = encodeItemId(feedId, guid);
      const flagPayload: Record<string, unknown> = { itemId, feedId };
      if (e.read !== null) flagPayload.read = e.read;
      if (e.starred !== null) flagPayload.starred = e.starred;
      flags.push(flagPayload);
    }
  }
  const body: { feeds?: unknown[]; flags?: unknown[] } = {};
  if (feeds.length) body.feeds = feeds;
  if (flags.length) body.flags = flags;
  return body;
}

function statsChunkToBody(chunk: DirtyEntry[]): { stats?: unknown[]; markers?: unknown[] } {
  const statsByFeed = new Map<string, DirtyEntry & { kind: 'stats-update' }>();
  const markersByItem = new Map<string, DirtyEntry & { kind: 'read-marker' }>();
  for (const entry of chunk) {
    if (entry.kind === 'stats-update') statsByFeed.set(entry.feedId, entry);
    if (entry.kind === 'read-marker') markersByItem.set(entry.itemId, entry);
  }
  const stats = [...statsByFeed.values()].map((entry) => ({
    feedId: entry.feedId,
    totalSeen: entry.totalSeen,
    feedUrl: entry.feedUrl,
    title: entry.title,
  }));
  const markers = [...markersByItem.values()].map((entry) => ({
    itemId: encodeItemId(entry.feedId, entry.itemId.slice(entry.itemId.lastIndexOf('::') + 2)),
    feedId: entry.feedId,
  }));
  const body: { stats?: unknown[]; markers?: unknown[] } = {};
  if (stats.length > 0) body.stats = stats;
  if (markers.length > 0) body.markers = markers;
  return body;
}

function toRemoteStatsRows(values: unknown[]): RemoteStatsRow[] {
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    if (typeof row.feed_id !== 'string') return [];
    return [{
      feedId: row.feed_id,
      totalSeen: typeof row.total_seen === 'number' ? row.total_seen : 0,
      readOnce: typeof row.read_once === 'number' ? row.read_once : 0,
      feedUrl: typeof row.feed_url === 'string' ? row.feed_url : null,
      title: typeof row.title === 'string' ? row.title : null,
    }];
  });
}

function toRawMarkerId(id: string): string {
  const parsed = decodeItemId(id);
  return parsed ? `${parsed.feedId}::${parsed.guid}` : id;
}

async function pushChunkWithSplit(entries: DirtyEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const body = chunkToBody(entries);
  try {
    await pushChunk(body);
    clearEntries(entries);
  } catch (err) {
    if (err instanceof SyncClientError && err.status === 413 && entries.length > 1) {
      const half = Math.floor(entries.length / 2);
      await pushChunkWithSplit(entries.slice(0, half));
      await pushChunkWithSplit(entries.slice(half));
      return;
    }
    throw err;
  }
}

async function pushStatsChunkWithSplit(entries: DirtyEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const response = await pushStatsChunk(statsChunkToBody(entries));
    const acknowledged = Array.isArray(response.acknowledged)
      ? response.acknowledged.filter((id): id is string => typeof id === 'string')
      : [];
    const rawAcknowledged = acknowledged.map(toRawMarkerId);
    await applyRemoteStatistics(toRemoteStatsRows(response.stats ?? []), [], rawAcknowledged);
    const acknowledgedSet = new Set(rawAcknowledged);
    clearEntries(entries.filter((entry) => entry.kind === 'stats-update' || (entry.kind === 'read-marker' && acknowledgedSet.has(entry.itemId))));
  } catch (err) {
    if (err instanceof SyncClientError && err.status === 413 && entries.length > 1) {
      const half = Math.floor(entries.length / 2);
      await pushStatsChunkWithSplit(entries.slice(0, half));
      await pushStatsChunkWithSplit(entries.slice(half));
      return;
    }
    throw err;
  }
}

export function scheduleFlush(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void flushNow();
  }, DEBOUNCE_MS);
}

export async function flushNow(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!await getStoredSyncKey()) {
      refreshPending();
      return;
    }
    const dirty = getDirty();
    if (dirty.length === 0) {
      refreshPending();
      return;
    }
    const ordinary = dirty.filter((entry) => entry.kind === 'feed-upsert' || entry.kind === 'feed-delete' || entry.kind === 'flag-update');
    const stats = dirty.filter((entry) => entry.kind === 'stats-update' || entry.kind === 'read-marker');
    const chunks = splitChunk(ordinary, MAX_DIRTY_PER_PUSH);
    for (const chunk of chunks) {
      if (chunk.length === 0) continue;
      await pushChunkWithSplit(chunk);
    }
    if (stats.length > 0 && await isStatsSyncAvailable()) {
      const statsChunks = splitChunk(stats, MAX_DIRTY_PER_PUSH);
      for (const chunk of statsChunks) {
        if (chunk.length === 0) continue;
        await pushStatsChunkWithSplit(chunk);
      }
    }
    markPushSuccess(Date.now());
  })();
  try {
    await inFlight;
  } catch (e) {
    console.error('Sync push failed:', e);
    markError('push', e);
    throw e;
  } finally {
    inFlight = null;
  }
}
