import type { Feed } from '../db/types';
import { normalizeTag } from '../util/tags';

export type RefreshTarget = ReadonlySet<string>;

export function feedsMatchingTags(feeds: Feed[], activeTags: readonly string[]): Feed[] {
  const tagSet = new Set(
    activeTags
      .map((tag) => normalizeTag(tag))
      .filter((tag): tag is string => tag !== null && tag.length > 0),
  );
  if (tagSet.size === 0) return [];
  return feeds.filter((feed) => feed.tags?.some((tag) => {
    const normalized = normalizeTag(tag);
    return normalized !== null && tagSet.has(normalized);
  }));
}

export function refreshTargetForSelection(
  feeds: Feed[],
  riverScope: string | null,
  activeTags: readonly string[],
): RefreshTarget {
  if (riverScope !== null) return new Set([riverScope]);
  if (activeTags.length === 0) return new Set(feeds.map((feed) => feed.id));
  return new Set(feedsMatchingTags(feeds, activeTags).map((feed) => feed.id));
}

export function refreshActionLabel(riverScope: string | null, activeTags: readonly string[]): string {
  if (riverScope !== null) return 'Refresh selected feed';
  if (activeTags.length > 0) return 'Refresh selected feeds';
  return 'Refresh all feeds';
}
