import type { ParsedSubscription } from './parse';
import { listFeeds } from '../db/feeds';
import { subscribeFeed } from '../feeds/service';

/** Strip the query string for matching only; the original URL is still stored. */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

export interface MergePreview {
  newSubscriptions: ParsedSubscription[];
  skipped: number;
  total: number;
}

export async function buildMergePreview(
  parsed: ParsedSubscription[],
): Promise<MergePreview> {
  const existing = await listFeeds();
  const existingUrls = new Set(existing.map((f) => normalizeUrl(f.url)));
  const newSubs: ParsedSubscription[] = [];
  let skipped = 0;
  const seenInImport = new Set<string>();
  for (const p of parsed) {
    const norm = normalizeUrl(p.xmlUrl);
    if (existingUrls.has(norm) || seenInImport.has(norm)) {
      skipped++;
    } else {
      seenInImport.add(norm);
      newSubs.push(p);
    }
  }
  return { newSubscriptions: newSubs, skipped, total: parsed.length };
}

export async function applyMerge(preview: MergePreview): Promise<void> {
  for (const p of preview.newSubscriptions) {
    await subscribeFeed({
      url: p.xmlUrl,
      title: p.title || p.xmlUrl,
      htmlUrl: p.htmlUrl,
      folder: p.folderPath.length > 0 ? p.folderPath : undefined,
    });
  }
}