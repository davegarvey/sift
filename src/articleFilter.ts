import type { Item } from './db/types';

export type ReadMode = 'all' | 'unread';

export function normalizeReadMode(value: unknown): ReadMode {
  return value === 'unread' ? 'unread' : 'all';
}

export function eligibleArticles(items: Item[], mode: ReadMode, starredOnly: boolean, retainedId: string | null): Item[] {
  return items.filter((item) => starredOnly ? item.starred : mode === 'all' || !item.read || item.id === retainedId);
}

export function remainingNeighbour(previous: Item[], remaining: Item[], openedId: string): string | null {
  const eligible = new Set(remaining.map((item) => item.id));
  const index = previous.findIndex((item) => item.id === openedId);
  if (eligible.has(openedId)) return openedId;
  return previous.slice(index + 1).find((item) => eligible.has(item.id))?.id
    ?? previous.slice(0, Math.max(0, index)).reverse().find((item) => eligible.has(item.id))?.id
    ?? remaining[0]?.id ?? null;
}
