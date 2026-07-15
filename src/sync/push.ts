/**
 * Push flusher. Reads the dirty set, batches into chunks, pushes each.
 * On success, clears the cleared entries from the dirty set. On failure,
 * applies backoff and retries.
 */

import { pushChunk, SyncClientError, MAX_DIRTY_PER_PUSH } from './client';
import { getDirty, clearDirtyIds, entryAt, type DirtyEntry } from './queue';
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
  const feeds: unknown[] = [];
  const flags: unknown[] = [];
  for (const e of chunk) {
    if (e.kind === 'feed-upsert' || e.kind === 'feed-delete') {
      const folder = e.kind === 'feed-upsert' ? e.folder : null;
      const title = e.kind === 'feed-upsert' ? e.title : null;
      const deleted = e.kind === 'feed-upsert' ? e.deleted : 1;
      const folderAt = e.kind === 'feed-upsert' ? e.folderAt : entryAt(e);
      const titleAt = e.kind === 'feed-upsert' ? e.titleAt : entryAt(e);
      const deletedAt = e.kind === 'feed-upsert' ? e.deletedAt : entryAt(e);
      const feedPayload: Record<string, unknown> = { feedUrl: e.feedUrl };
      if (folder !== null) feedPayload.folder = { value: folder, at: folderAt };
      if (title !== null) feedPayload.title = { value: title, at: titleAt };
      feedPayload.deleted = { value: deleted, at: deletedAt };
      feeds.push(feedPayload);
    } else {
      // The wire format uses the encoded item_id so feed URLs containing
      // literal `::` are not ambiguous with the separator.
      const lastSep = e.itemId.lastIndexOf('::');
      const feedUrl = e.feedUrl;
      const guid = lastSep >= 0 ? e.itemId.slice(lastSep + 2) : e.itemId;
      const itemId = encodeItemId(feedUrl, guid);
      const flagPayload: Record<string, unknown> = { itemId, feedUrl };
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
    // Entries consumed (mapped 1:1).
    const allIds = new Set(entries.map((_, i) => i));
    clearDirtyIds(allIds);
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
