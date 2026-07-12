/**
 * Sync dirty set.
 *
 * An in-memory array of pending changes, persisted to the IDB meta store
 * under `sync_dirty` on debounce, beforeunload, visibilitychange, and
 * after each successful push.
 *
 * Bounded by MAX_DIRTY_PER_PUSH — the flusher is triggered immediately
 * if the array exceeds this size.
 */

import { getMeta, setMeta } from '../db/meta';
import { MAX_DIRTY_PER_PUSH } from './client';

const DIRTY_KEY = 'sync_dirty';

export type DirtyEntry =
  | { kind: 'feed-upsert'; feedUrl: string; folder: string[] | null; folderAt: number; title: string | null; titleAt: number; deleted: 0 | 1; deletedAt: number }
  | { kind: 'feed-delete'; feedUrl: string; at: number }
  | { kind: 'flag-update'; itemId: string; feedUrl: string; read: 0 | 1 | null; readAt: number; starred: 0 | 1 | null; starredAt: number };

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

export function clearDirtyIds(ids: Set<number>): void {
  inMemory = inMemory.filter((_, i) => !ids.has(i));
  schedulePersist();
}

export function clearAllDirty(): void {
  inMemory = [];
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
      return Math.max(e.folderAt, e.titleAt, e.deletedAt);
    case 'feed-delete':
      return e.at;
    case 'flag-update':
      return Math.max(e.readAt, e.starredAt);
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
  feedUrl: string;
  folder: string[] | null;
  folderAt: number;
  title: string | null;
  titleAt: number;
  deleted: 0 | 1;
  deletedAt: number;
}): void {
  appendEntry({
    kind: 'feed-upsert',
    feedUrl: feed.feedUrl,
    folder: feed.folder,
    folderAt: feed.folderAt,
    title: feed.title,
    titleAt: feed.titleAt,
    deleted: feed.deleted,
    deletedAt: feed.deletedAt,
  });
}

export function enqueueFeedDelete(feedUrl: string, at: number): void {
  appendEntry({ kind: 'feed-delete', feedUrl, at });
}

export function enqueueFlag(flag: {
  itemId: string;
  feedUrl: string;
  read: 0 | 1 | null;
  readAt: number;
  starred: 0 | 1 | null;
  starredAt: number;
}): void {
  appendEntry({
    kind: 'flag-update',
    itemId: flag.itemId,
    feedUrl: flag.feedUrl,
    read: flag.read,
    readAt: flag.readAt,
    starred: flag.starred,
    starredAt: flag.starredAt,
  });
}

export { entryAt };
