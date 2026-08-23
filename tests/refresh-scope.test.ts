import { describe, expect, it } from 'vitest';
import type { Feed } from '../src/db/types';
import { refreshActionLabel, refreshTargetForSelection } from '../src/feeds/scope';

const feed = (id: string, tags?: string[]): Feed => ({
  id,
  url: `https://${id}.example/feed`,
  title: id,
  tags,
  lastFetched: null,
  learnedIntervalMs: 3_600_000,
});

describe('refresh target selection', () => {
  const feeds = [
    feed('dev', ['Development']),
    feed('design', ['design']),
    feed('untagged'),
  ];

  it('snapshots every feed in All mode', () => {
    expect(refreshTargetForSelection(feeds, null, [])).toEqual(new Set(['dev', 'design', 'untagged']));
  });

  it('targets only the selected feed', () => {
    expect(refreshTargetForSelection(feeds, 'design', [])).toEqual(new Set(['design']));
  });

  it('matches tags case-insensitively with OR semantics', () => {
    expect(refreshTargetForSelection(feeds, null, ['development', 'DESIGN'])).toEqual(new Set(['dev', 'design']));
  });

  it('keeps an unmatched tag as an empty target', () => {
    expect(refreshTargetForSelection(feeds, null, ['missing'])).toEqual(new Set());
  });

  it('ignores the starred item filter because it is not part of the target', () => {
    expect(refreshTargetForSelection(feeds, null, [])).toEqual(new Set(['dev', 'design', 'untagged']));
  });
});

describe('refresh action labels', () => {
  it('describes All mode', () => {
    expect(refreshActionLabel(null, [])).toBe('Refresh all feeds');
  });

  it('describes a feed scope', () => {
    expect(refreshActionLabel('feed-id', [])).toBe('Refresh selected feed');
  });

  it('describes a tag scope', () => {
    expect(refreshActionLabel(null, ['news'])).toBe('Refresh selected feeds');
  });
});
