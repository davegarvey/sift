import { getMeta, setMeta } from '../db/meta';
import { MAX_DIRTY_PER_PUSH } from './client';

const DIRTY_KEY = 'sync_dirty';

export type DirtyEntry =
  | { kind: 'feed-upsert'; feedId: string; folder: string[] | null; folderAt: number; title: string | null; titleAt: number; feedUrl: { value: string | null; at: number } | null; tags: string[] | null; tagsAt: number; deleted: 0 | 1; deletedAt: number }
  | { kind: 'feed-delete'; feedId: string; at: number }
  | { kind: 'flag-update'; itemId: string; feedId: string; read: 0 | 1 | null; readAt: number; starred: 0 | 1 | null; starredAt: number };

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
      return Math.max(e.folderAt, e.titleAt, e.tagsAt, e.feedUrl?.at ?? 0, e.deletedAt);
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
  feedId: string;
  folder: string[] | null;
  folderAt: number;
  title: string | null;
  titleAt: number;
  feedUrl: { value: string | null; at: number } | null;
  tags: string[] | null;
  tagsAt: number;
  deleted: 0 | 1;
  deletedAt: number;
}): void {
  appendEntry({
    kind: 'feed-upsert',
    feedId: feed.feedId,
    folder: feed.folder,
    folderAt: feed.folderAt,
    title: feed.title,
    titleAt: feed.titleAt,
    feedUrl: feed.feedUrl,
    tags: feed.tags,
    tagsAt: feed.tagsAt,
    deleted: feed.deleted,
    deletedAt: feed.deletedAt,
  });
}

export function enqueueFeedDelete(feedId: string, at: number): void {
  appendEntry({ kind: 'feed-delete', feedId, at });
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

export { entryAt };
