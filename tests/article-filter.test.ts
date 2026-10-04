import { describe, expect, it } from 'vitest';
import { eligibleArticles, normalizeReadMode, remainingNeighbour } from '../src/articleFilter';
import type { Item } from '../src/db/types';

const items = [
  { id: 'a', read: false, starred: true },
  { id: 'b', read: true, starred: true },
  { id: 'c', read: false, starred: false },
] as Item[];

describe('article filter', () => {
  it('defaults invalid or absent preferences to All', () => {
    expect(normalizeReadMode(undefined)).toBe('all');
    expect(normalizeReadMode('legacy')).toBe('all');
    expect(normalizeReadMode('unread')).toBe('unread');
  });

  it('retains only the current read article until it is released', () => {
    expect(eligibleArticles(items, 'unread', false, 'b').map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(eligibleArticles(items, 'unread', false, null).map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('bypasses unread filtering for starred articles', () => {
    expect(eligibleArticles(items, 'unread', true, null).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('restores next, then previous, then empty focus', () => {
    expect(remainingNeighbour(items, [items[0], items[2]], 'b')).toBe('c');
    expect(remainingNeighbour(items, [items[0]], 'b')).toBe('a');
    expect(remainingNeighbour(items, [], 'b')).toBeNull();
    expect(remainingNeighbour(items, items, 'b')).toBe('b');
  });
});
