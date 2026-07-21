import { pushChunk, SyncClientError, MAX_DIRTY_PER_PUSH } from './client';
import { getDirty, clearEntries, entryAt, type DirtyEntry } from './queue';
import { encodeItemId } from './itemId';

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
    if (e.kind === 'feed-upsert' || e.kind === 'feed-delete') {
      const folder = e.kind === 'feed-upsert' ? e.folder : null;
      const title = e.kind === 'feed-upsert' ? e.title : null;
      const tags = e.kind === 'feed-upsert' ? e.tags : null;
      const feedUrl = e.kind === 'feed-upsert' ? e.feedUrl : null;
      const htmlUrl = e.kind === 'feed-upsert' ? e.htmlUrl : null;
      const deleted = e.kind === 'feed-upsert' ? e.deleted : 1;
      const folderAt = e.kind === 'feed-upsert' ? e.folderAt : entryAt(e);
      const titleAt = e.kind === 'feed-upsert' ? e.titleAt : entryAt(e);
      const tagsAt = e.kind === 'feed-upsert' ? e.tagsAt : entryAt(e);
      const feedUrlAt = e.kind === 'feed-upsert' ? (e.feedUrl?.at ?? entryAt(e)) : entryAt(e);
      const htmlUrlAt = e.kind === 'feed-upsert' ? (e.htmlUrl?.at ?? entryAt(e)) : entryAt(e);
      const deletedAt = e.kind === 'feed-upsert' ? e.deletedAt : entryAt(e);
      const feedPayload: Record<string, unknown> = { feedId: e.feedId };
      if (folder !== null) feedPayload.folder = { value: folder, at: folderAt };
      if (title !== null) feedPayload.title = { value: title, at: titleAt };
      if (feedUrl !== null) feedPayload.feedUrl = { value: feedUrl.value, at: feedUrlAt };
      if (htmlUrl !== null) feedPayload.htmlUrl = { value: htmlUrl.value, at: htmlUrlAt };
      if (tags !== null) feedPayload.tags = { value: tags, at: tagsAt };
      feedPayload.deleted = { value: deleted, at: deletedAt };
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
    if (dirty.length === 0) return;
    const chunks = splitChunk(dirty, MAX_DIRTY_PER_PUSH);
    let offset = 0;
    for (const chunk of chunks) {
      const indices = chunk.map(() => offset++);
      const entries = indices.map((i) => dirty[i]);
      await pushChunkWithSplit(entries);
    }
  })();
  try {
    await inFlight;
  } catch (e) {
    console.error('Sync push failed:', e);
    throw e;
  } finally {
    inFlight = null;
  }
}
