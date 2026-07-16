import { describe, it, expect } from 'vitest';

interface Feed {
  url: string;
  tags?: string[];
}

function filterFeedsByTags(feeds: Feed[], activeTags: string[]): Feed[] {
  if (activeTags.length === 0) return feeds;
  const tagSet = new Set(activeTags);
  return feeds.filter((f) => f.tags?.some((t) => tagSet.has(t)));
}

function filterItems(items: Array<{ feedUrl: string }>, matchingFeeds: Set<string>): Array<{ feedUrl: string }> {
  if (matchingFeeds.size === 0) return items;
  return items.filter((i) => matchingFeeds.has(i.feedUrl));
}

describe('tag filter logic', () => {
  const feeds: Feed[] = [
    { url: 'https://a.com/feed', tags: ['dev', 'rust'] },
    { url: 'https://b.com/feed', tags: ['design'] },
    { url: 'https://c.com/feed', tags: ['dev', 'python'] },
    { url: 'https://d.com/feed', tags: [] },
    { url: 'https://e.com/feed' },
  ];

  it('returns all feeds when no tags active', () => {
    expect(filterFeedsByTags(feeds, [])).toEqual(feeds);
  });

  it('filters by single tag', () => {
    const result = filterFeedsByTags(feeds, ['rust']);
    expect(result).toEqual([feeds[0]]);
  });

  it('filters by multi-tag OR', () => {
    const result = filterFeedsByTags(feeds, ['dev', 'design']);
    expect(result).toEqual([feeds[0], feeds[1], feeds[2]]);
  });

  it('returns no feeds when no match', () => {
    const result = filterFeedsByTags(feeds, ['golang']);
    expect(result).toEqual([]);
  });

  it('filters items by matching feeds', () => {
    const items = [
      { feedUrl: 'https://a.com/feed' },
      { feedUrl: 'https://b.com/feed' },
      { feedUrl: 'https://c.com/feed' },
      { feedUrl: 'https://d.com/feed' },
    ];
    const matchingFeeds = new Set(['https://a.com/feed', 'https://c.com/feed']);
    const result = filterItems(items, matchingFeeds);
    expect(result).toEqual([items[0], items[2]]);
  });

  it('returns all items when matchingFeeds is empty (all feeds fallback)', () => {
    const items = [{ feedUrl: 'https://a.com/feed' }, { feedUrl: 'https://b.com/feed' }];
    expect(filterItems(items, new Set())).toEqual(items);
  });

  it('handles feeds with no tags property', () => {
    const feedsWithUndefined: Feed[] = [
      { url: 'https://a.com/feed', tags: ['dev'] },
      { url: 'https://b.com/feed' },
    ];
    const result = filterFeedsByTags(feedsWithUndefined, ['dev']);
    expect(result).toEqual([feedsWithUndefined[0]]);
  });
});
