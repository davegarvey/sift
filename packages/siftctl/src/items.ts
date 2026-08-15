import { extractFromXml, type FeedEntry } from '@extractus/feed-extractor';

export interface CliItem {
  title: string;
  link?: string;
  publishedAt: number | null;
  excerpt: string;
  guid: string;
  itemId: string;
}

/**
 * Fetch and parse a feed, mirroring the Sift browser's item identity rules
 * (src/feeds/parse.ts) so item IDs produced here match the flags the
 * browser writes: guid ?? id, else `${link}|${published}`, else link.
 */
export async function fetchItems(feedUrl: string, limit: number): Promise<CliItem[]> {
  let res: Response;
  try {
    res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'siftctl/0.1' },
      redirect: 'follow',
    });
  } catch {
    throw new Error(`Failed to fetch feed: ${feedUrl}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching feed: ${feedUrl}`);
  const xml = await res.text();

  let data: Awaited<ReturnType<typeof extractFromXml>>;
  try {
    data = extractFromXml(xml, {
      descriptionMaxLen: 0,
      getExtraEntryFields: (raw) => {
        const entry = raw as Record<string, unknown>;
        const rawGuid = entry['guid'] ?? entry['id'];
        const link = typeof entry['link'] === 'string' ? entry['link'] : undefined;
        const published = entry['pubDate'] ?? entry['published'] ?? entry['updated'];
        let stableGuid: string | undefined;
        if (typeof rawGuid === 'string' && rawGuid.length > 0) {
          stableGuid = rawGuid;
        } else if (link && typeof published === 'string') {
          stableGuid = `${link}|${published}`;
        } else if (link) {
          stableGuid = link;
        }
        const result: Record<string, unknown> = {};
        if (stableGuid) result['_guid'] = stableGuid;
        return result;
      },
    });
  } catch {
    throw new Error(`Failed to parse feed XML: ${feedUrl}`);
  }
  if (!data) throw new Error(`Failed to parse feed XML: ${feedUrl}`);

  return (data['entries'] ?? [])
    .map((entry) => mapEntry(entry, feedUrl))
    .filter((i): i is CliItem => i !== null)
    .slice(0, limit);
}

function mapEntry(entry: FeedEntry, feedUrl: string): CliItem | null {
  const extra = entry as FeedEntry & { _guid?: string };
  const guid = extra['_guid'] ?? entry.id ?? entry.link ?? '';
  if (!guid) return null;
  const publishedAt = parseDate(entry.published);
  const excerpt = (entry.description ?? '').slice(0, 500);
  return {
    title: entry.title ?? '(untitled)',
    link: entry.link,
    publishedAt,
    excerpt,
    guid,
    itemId: `${encodeURIComponent(feedUrl)}::${guid}`,
  };
}

/**
 * Parse a feed date into epoch ms, or null when unusable: missing,
 * unparseable, or in the future. Mirrors src/feeds/parse.ts.
 */
function parseDate(value: string | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return t <= now ? t : null;
}
