import { extractFromXml, type FeedData, type FeedEntry } from '@extractus/feed-extractor';
import type { Item } from '../db/types';

export interface ParsedFeed {
  title: string;
  htmlUrl?: string;
  description?: string;
  items: ParsedItem[];
}

export interface ParsedItem {
  guid: string;
  title: string;
  link?: string;
  author?: string;
  publishedAt: number;
  excerpt: string;
  html?: string;
  thumbnail?: string | null;
}

/**
 * Parse a feed XML body (RSS 2.0, Atom 1.0, or RDF/RSS 1.0) into a normalized
 * shape that maps cleanly to our IndexedDB records.
 *
 * Uses `@extractus/feed-extractor` for the bulk of work, then augments each
 * entry with the raw `content:encoded` / `content` HTML when present so the
 * reading view can prefer the feed's full content over Readability extraction.
 */
export function parseFeed(xml: string): ParsedFeed | null {
  let data: FeedData;
  try {
    data = extractFromXml(xml, {
      descriptionMaxLen: 0,
      getExtraEntryFields: (raw) => {
        // Pull `content:encoded` (RSS) or `content` (Atom) and any author info.
        const entry = raw as Record<string, unknown>;
        const contentEncoded = entry['content:encoded'];
        const contentField = entry['content'];
        const content =
          contentField && typeof contentField === 'object'
            ? (contentField as Record<string, unknown>)['_']
            : contentField;
        const html = typeof content === 'string' ? content : '';
        const finalHtml = typeof contentEncoded === 'string' ? contentEncoded : html;
        const author = pickAuthor(entry);
        // The library auto-generates ids when `guid`/`id` is missing, but
        // those ids are NOT stable across parses (random+timestamp) which
        // breaks dedup across refreshes. We compute our own stable guid from
        // link+publishedAt here so mapEntry can use it instead.
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
        const thumbnail = pickThumbnail(entry);
        const result: Record<string, unknown> = {};
        if (finalHtml) result['_html'] = finalHtml;
        if (author) result['_author'] = author;
        if (stableGuid) result['_guid'] = stableGuid;
        if (thumbnail) result['_thumbnail'] = thumbnail;
        return result;
      },
    });
  } catch {
    return null;
  }
  if (!data) return null;
  const items = (data['entries'] ?? [])
    .map((entry) => mapEntry(entry))
    .filter((i): i is ParsedItem => i !== null);
  return {
    title: data.title ?? '(untitled)',
    htmlUrl: data.link,
    description: data.description,
    items,
  };
}

function pickThumbnail(entry: Record<string, unknown>): string | undefined {
  // RSS media:thumbnail
  const mediaThumb = entry['media:thumbnail'];
  if (mediaThumb && typeof mediaThumb === 'object') {
    const url = (mediaThumb as Record<string, unknown>)['@_url'];
    if (typeof url === 'string') return url;
  }
  // RSS media:content with image type
  const mediaContent = entry['media:content'];
  if (mediaContent && typeof mediaContent === 'object') {
    const mc = mediaContent as Record<string, unknown>;
    const type = mc['@_type'];
    const url = mc['@_url'];
    if (typeof url === 'string' && (typeof type !== 'string' || type.startsWith('image/'))) return url;
  }
  // Atom media:thumbnail (href attribute)
  if (mediaThumb && typeof mediaThumb === 'object') {
    const href = (mediaThumb as Record<string, unknown>)['@_href'];
    if (typeof href === 'string') return href;
  }
  return undefined;
}

function pickAuthor(entry: Record<string, unknown>): string | undefined {
  const author = entry['author'];
  if (typeof author === 'string') return author;
  if (author && typeof author === 'object') {
    const a = author as Record<string, unknown>;
    if (typeof a['name'] === 'string') return a['name'];
  }
  const dcCreator = entry['dc:creator'];
  if (typeof dcCreator === 'string') return dcCreator;
  return undefined;
}

function mapEntry(entry: FeedEntry): ParsedItem | null {
  const extra = entry as FeedEntry & {
    _guid?: string;
    _html?: string;
    _author?: string;
    _thumbnail?: string;
  };
  const guid = extra['_guid'] ?? entry.id ?? entry.link ?? '';
  if (!guid) return null;
  const publishedAt = parseDate(entry.published);
  const excerpt = (entry.description ?? '').slice(0, 500);
  const html = extra['_html'] && extra['_html'].length > 0 ? extra['_html'] : undefined;
  return {
    guid,
    title: entry.title ?? '(untitled)',
    link: entry.link,
    author: extra['_author'],
    publishedAt,
    excerpt,
    html,
    thumbnail: extra['_thumbnail'] ?? null,
  };
}

function parseDate(value: string | undefined): number {
  if (!value) return Date.now();
  const t = Date.parse(value);
  return Number.isNaN(t) ? Date.now() : t;
}

/**
 * Convert a ParsedFeed into IndexedDB Item rows. Each item's id is
 * `${feedUrl}::${guid}`, which gives stable identity across refreshes.
 */
export function parsedToItems(parsed: ParsedFeed, feedUrl: string): Item[] {
  const now = Date.now();
  return parsed.items.map((p) => {
    const id = `${feedUrl}::${p.guid}`;
    return {
      id,
      feedUrl,
      guid: p.guid,
      title: p.title,
      author: p.author,
      link: p.link,
      publishedAt: p.publishedAt,
      updatedAt: p.publishedAt,
      excerpt: p.excerpt,
      html: p.html,
      thumbnail: p.thumbnail ?? null,
      extractedHtml: null,
      firstOpenedAt: null,
      read: false,
      starred: false,
      createdAt: now,
    } satisfies Item;
  });
}