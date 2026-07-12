/**
 * Item-ID encoding/decoding.
 *
 * Wire format: `encodeURIComponent(feedUrl) + "::" + guid`.
 * On parse, split at the *last* `::` (in case feedUrl contains the literal
 * sequence after URL-encoding it — though encoded `%3A%3A` is no longer
 * literal `::`).
 */

export interface ParsedItemId {
  feedUrl: string;
  guid: string;
}

export function encodeItemId(feedUrl: string, guid: string): string {
  return encodeURIComponent(feedUrl) + '::' + guid;
}

export function decodeItemId(itemId: string): ParsedItemId | null {
  const lastSep = itemId.lastIndexOf('::');
  if (lastSep === -1) return null;
  const encodedFeed = itemId.slice(0, lastSep);
  const guid = itemId.slice(lastSep + 2);
  let feedUrl: string;
  try {
    feedUrl = decodeURIComponent(encodedFeed);
  } catch {
    return null;
  }
  return { feedUrl, guid };
}
