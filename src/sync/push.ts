import { pushChunk, SyncClientError, MAX_DIRTY_PER_PUSH } from './client';
import { getDirty, clearEntries, entryAt, type DirtyEntry } from './queue';
import { encodeItemId } from './itemId';
import { markPushSuccess, markError, refreshPending } from './status';

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

  const feeds: unknown[] = [];
  const flags: unknown[] = [];
  for (const e of deduped) {
    if (e.kind === 'feed-upsert') {
      const feedPayload: Record<string, unknown> = { feedId: e.feedId };
      if (e.folder !== null) feedPayload.folder = { value: e.folder, at: e.folderAt };
      if (e.title !== null) feedPayload.title = { value: e.title, at: e.titleAt };
      if (e.feedUrl !== null) feedPayload.feedUrl = { value: e.feedUrl.value, at: e.feedUrl.at };
      if (e.htmlUrl !== null) feedPayload.htmlUrl = { value: e.htmlUrl.value, at: e.htmlUrl.at };
      if (e.tags !== null) feedPayload.tags = { value: e.tags, at: e.tagsAt };
      if (e.deleted !== null && e.deletedAt !== null) {
        feedPayload.deleted = { value: e.deleted, at: e.deletedAt };
      }
      feeds.push(feedPayload);
    } else if (e.kind === 'feed-delete') {
      const feedPayload: Record<string, unknown> = { feedId: e.feedId };
      feedPayload.feedUrl = { value: e.feedUrl.value, at: e.feedUrl.at };
      feedPayload.deleted = { value: 1, at: e.at };
      feeds.push(feedPayload);
    } else {
      const lastSep = e.itemId.lastIndexOf('::');
      const feedId = e.feedId;
      const guid = lastSep >= 0 ? e.itemId.slice(lastSep + 2) : e.itemId;
      const itemId = encodeItemId(feedId, guid);
      const flagPayload: Record<string, unknown> = { itemId, feedId };
      if (e.read !== null) flagPayload.read = { value: e.read, at: e.readAt };
      if (e.starred !== null) flagPayload.starred = { value: e.starred, at: e.starredAt };
      flags.push(flagPayload);
    }
  }
  const body: { feeds?: unknown[]; flags?: unknown[] } = {};
  if (feeds.length) body.feeds = feeds;
  if (flags.length) body.flags = flags;
  return body;
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
    const dirty = getDirty();
    if (dirty.length === 0) {
      refreshPending();
      return;
    }
    const chunks = splitChunk(dirty, MAX_DIRTY_PER_PUSH);
    let offset = 0;
    for (const chunk of chunks) {
      const indices = chunk.map(() => offset++);
      const entries = indices.map((i) => dirty[i]);
      await pushChunkWithSplit(entries);
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
