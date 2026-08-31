import { getMeta, setMeta } from '../db/meta';
import { MAX_DIRTY_PER_PUSH } from './client';
import { getStoredSyncKey } from './key';

const DIRTY_KEY = 'sync_dirty';

export type DirtyEntry =
  | { kind: 'feed-upsert'; feedId: string; folder: string[] | null; folderAt: number; title: string | null; titleAt: number; feedUrl: { value: string | null; at: number } | null; htmlUrl: { value: string | null; at: number } | null; tags: string[] | null; tagsAt: number; deleted: 0 | 1 | null; deletedAt: number | null }
  | { kind: 'feed-delete'; feedId: string; feedUrl: { value: string; at: number }; at: number }
  | { kind: 'flag-update'; itemId: string; feedId: string; read: 0 | 1 | null; readAt: number; starred: 0 | 1 | null; starredAt: number }
  | { kind: 'stats-update'; feedId: string; totalSeen: number; feedUrl: string | null; title: string | null; at: number }
  | { kind: 'read-marker'; itemId: string; feedId: string; at: number };

let inMemory: DirtyEntry[] = [];
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let onOverflow: (() => void) | null = null;

export function setOnOverflow(fn: (() => void) | null): void {
  onOverflow = fn;
}

export async function loadDirty(): Promise<DirtyEntry[]> {
  if (loaded) return inMemory;
  const stored = await getMeta<DirtyEntry[]>(DIRTY_KEY, []);
  inMemory = Array.isArray(stored) ? stored : [];
  loaded = true;
  return inMemory;
}

export function getDirty(): DirtyEntry[] {
  return inMemory;
}

export function clearEntries(entries: DirtyEntry[]): void {
  const remove = new Set(entries);
  inMemory = inMemory.filter((e) => !remove.has(e));
  schedulePersist();
}

export function clearAllDirty(): void {
  inMemory = [];
  schedulePersist();
}

function rekeyItemId(itemId: string, fromId: string, toId: string): string {
  const prefix = `${fromId}::`;
  return itemId.startsWith(prefix) ? `${toId}::${itemId.slice(prefix.length)}` : itemId;
}

export function rekeyDirtyFeedId(fromId: string, toId: string): void {
  if (fromId === toId) return;
  inMemory = inMemory.map((entry) => {
    switch (entry.kind) {
      case 'feed-upsert':
        return entry.feedId === fromId ? { ...entry, feedId: toId } : entry;
      case 'feed-delete':
        return entry.feedId === fromId
          ? { ...entry, feedId: toId }
          : entry;
      case 'flag-update':
        return entry.feedId === fromId
          ? { ...entry, feedId: toId, itemId: rekeyItemId(entry.itemId, fromId, toId) }
          : entry;
      case 'stats-update':
        return entry.feedId === fromId ? { ...entry, feedId: toId } : entry;
      case 'read-marker':
        return entry.feedId === fromId
          ? { ...entry, feedId: toId, itemId: rekeyItemId(entry.itemId, fromId, toId) }
          : entry;
    }
  });
  schedulePersist();
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistDirty();
  }, 200);
}

export async function persistDirty(): Promise<void> {
  persistTimer = null;
  await setMeta(DIRTY_KEY, inMemory);
}

function entryAt(e: DirtyEntry): number {
  switch (e.kind) {
    case 'feed-upsert':
      return Math.max(e.folderAt, e.titleAt, e.tagsAt, e.feedUrl?.at ?? 0, e.htmlUrl?.at ?? 0, e.deletedAt ?? 0);
    case 'feed-delete':
      return Math.max(e.feedUrl.at, e.at);
    case 'flag-update':
      return Math.max(e.readAt, e.starredAt);
    case 'stats-update':
      return e.at;
    case 'read-marker':
      return e.at;
  }
}

function appendEntry(e: DirtyEntry): void {
  inMemory.push(e);
  if (inMemory.length >= MAX_DIRTY_PER_PUSH && onOverflow) {
    onOverflow();
  }
  schedulePersist();
}

export function enqueueFeed(feed: {
  feedId: string;
  folder: string[] | null;
  folderAt: number;
  title: string | null;
  titleAt: number;
  feedUrl: { value: string | null; at: number } | null;
  htmlUrl: { value: string | null; at: number } | null;
  tags: string[] | null;
  tagsAt: number;
  deleted: 0 | 1 | null;
  deletedAt: number | null;
}): void {
  appendEntry({
    kind: 'feed-upsert',
    feedId: feed.feedId,
    folder: feed.folder,
    folderAt: feed.folderAt,
    title: feed.title,
    titleAt: feed.titleAt,
    feedUrl: feed.feedUrl,
    htmlUrl: feed.htmlUrl,
    tags: feed.tags,
    tagsAt: feed.tagsAt,
    deleted: feed.deleted,
    deletedAt: feed.deletedAt,
  });
}

export function enqueueFeedDelete(feedId: string, feedUrl: { value: string; at: number }, at: number): void {
  inMemory = inMemory.filter((e) => !(e.kind === 'feed-upsert' && e.feedId === feedId));
  appendEntry({ kind: 'feed-delete', feedId, feedUrl, at });
}

export function enqueueFlag(flag: {
  itemId: string;
  feedId: string;
  read: 0 | 1 | null;
  readAt: number;
  starred: 0 | 1 | null;
  starredAt: number;
}): void {
  appendEntry({
    kind: 'flag-update',
    itemId: flag.itemId,
    feedId: flag.feedId,
    read: flag.read,
    readAt: flag.readAt,
    starred: flag.starred,
    starredAt: flag.starredAt,
  });
}

export function enqueueStats(stats: {
  feedId: string;
  totalSeen: number;
  feedUrl?: string | null;
  title?: string | null;
  at?: number;
}): void {
  appendEntry({
    kind: 'stats-update',
    feedId: stats.feedId,
    totalSeen: stats.totalSeen,
    feedUrl: stats.feedUrl ?? null,
    title: stats.title ?? null,
    at: stats.at ?? Date.now(),
  });
}

export function enqueueReadMarker(item: { itemId: string; feedId: string; at?: number }): void {
  appendEntry({
    kind: 'read-marker',
    itemId: item.itemId,
    feedId: item.feedId,
    at: item.at ?? Date.now(),
  });
}

export async function enqueueStatsIfSync(stats: {
  feedId: string;
  totalSeen: number;
  feedUrl?: string | null;
  title?: string | null;
  at?: number;
}): Promise<void> {
  if (await getStoredSyncKey()) enqueueStats(stats);
}

export async function enqueueReadMarkerIfSync(item: { itemId: string; feedId: string; at?: number }): Promise<void> {
  if (await getStoredSyncKey()) enqueueReadMarker(item);
}

export { entryAt };
