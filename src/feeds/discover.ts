import { fetchFeed, fetchArticleHtml } from './fetch';
import { parseFeed } from './parse';

export interface DiscoveredFeed {
  url: string;
  title: string;
  /** 3 sample item titles, for the Add Feed confirmation modal. */
  samples: string[];
}

/**
 * Discover a feed from an arbitrary URL. Try parsing the URL as a feed
 * first; if that fails, fetch the page and look for
 * `<link rel="alternate" type="application/rss+xml">` (or atom+xml).
 *
 * Returns the discovered feed URL (and metadata for preview) or null.
 */
export async function discoverFeed(url: string): Promise<DiscoveredFeed | null> {
  // 1. Maybe the URL itself is a feed.
  const direct = await tryParse(url);
  if (direct) return { url, title: direct.title, samples: firstThree(direct) };

  // 2. Maybe the URL is a page that links to one or more feeds.
  const html = await fetchArticleHtml(url);
  if (html) {
    const candidates = findAlternateFeeds(html, url);
    for (const candidate of candidates) {
      const parsed = await tryParse(candidate);
      if (parsed) {
        return { url: candidate, title: parsed.title, samples: firstThree(parsed) };
      }
    }
  }
  return null;
}

async function tryParse(url: string) {
  const result = await fetchFeed(url);
  if (result.kind !== 'modified') return null;
  return parseFeed(result.body);
}

/**
 * Walk rel="alternate" link tags (RSS/Atom) from an HTML page.
 *
 * Uses a lightweight regex scan rather than DOMParser so this works in any
 * environment (Deno, Node, browser) without polyfills. Discovery only
 * requires finding the small set of well-known link tags.
 */
export function findAlternateFeeds(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(tag)) !== null) {
      const key = a[1].toLowerCase();
      const val = a[2] ?? a[3] ?? '';
      attrs[key] = val;
    }
    const rel = (attrs['rel'] || '').toLowerCase();
    const type = (attrs['type'] || '').toLowerCase();
    if (
      rel.includes('alternate') &&
      (type.includes('application/rss+xml') || type.includes('application/atom+xml'))
    ) {
      const href = attrs['href'];
      if (!href) continue;
      try {
        out.push(new URL(href, baseUrl).toString());
      } catch {
        // ignore malformed URLs
      }
    }
  }
  return Array.from(new Set(out));
}

function firstThree(parsed: { items: { title: string }[] }): string[] {
  return parsed.items.slice(0, 3).map((i) => i.title);
}