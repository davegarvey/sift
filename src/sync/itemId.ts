export interface ParsedItemId {
  feedId: string;
  guid: string;
}

export function encodeItemId(feedId: string, guid: string): string {
  return encodeURIComponent(feedId) + '::' + guid;
}

export function decodeItemId(itemId: string): ParsedItemId | null {
  const lastSep = itemId.lastIndexOf('::');
  if (lastSep === -1) return null;
  const encodedFeed = itemId.slice(0, lastSep);
  const guid = itemId.slice(lastSep + 2);
  let feedId: string;
  try {
    feedId = decodeURIComponent(encodedFeed);
  } catch {
    return null;
  }
  return { feedId, guid };
}
