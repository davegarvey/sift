import type { Item } from '../db/types';
import { getItem, updateItem } from '../db/items';
import { extractArticle } from './extract';
import { runEviction } from './eviction';

function processLinks(html: string, baseUrl?: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = Array.from(doc.querySelectorAll('a[href]'));
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!href) continue;
    if (baseUrl) {
      try {
        const resolved = new URL(href, baseUrl);
        const resolvedStr = resolved.toString();
        if (resolvedStr !== href) {
          // Relative URL resolved correctly against the article's URL.
          link.setAttribute('href', resolvedStr);
        } else if (resolved.origin === window.location.origin && resolved.origin !== new URL(baseUrl).origin) {
          // Absolute URL pointing to Sift's origin but should point to the
          // article's origin — Readability resolved a relative link against
          // the document's baseURI (which was Sift's page) instead of the
          // article's URL. Re-resolve using just the path/query/hash.
          link.setAttribute('href', new URL(resolved.pathname + resolved.search + resolved.hash, baseUrl).toString());
        }
      } catch {
        // leave invalid URLs as-is
      }
    }
    if (!link.hasAttribute('target') || link.getAttribute('target') !== '_blank') {
      link.setAttribute('target', '_blank');
    }
    link.setAttribute('rel', 'noopener noreferrer');
  }
  return doc.body.innerHTML;
}

/**
 * High-level "open an item in the reading view" service.
 *
 * Returns the HTML to render for the item's body, following the strategy:
 *  1. If the item already has cached extractedHtml, use it (text-only or
 *     inlined — the reading view can lazy-re-inline images on scroll).
 *  2. Otherwise, if the feed item has full `html` (full content in the
 *     feed itself), use that HTML directly. Mark firstOpenedAt.
 *  3. Otherwise (summary-only feed), call `extractArticle` and cache the
 *     result. On extraction failure, return null — the reading view will
 *     render the excerpt and an "Open original ↗" link.
 *
 * Sets `firstOpenedAt = now` on first open so eviction can use it.
 */
export async function openItemForReading(
  itemId: string,
): Promise<{
  bodyHtml: string;
  extracted: boolean;
  extractionFailed: boolean;
}> {
  const item = await getItem(itemId);
  if (!item) {
    return { bodyHtml: '', extracted: false, extractionFailed: true };
  }

  // Mark first-open timestamp regardless of which path we take.
  if (item.firstOpenedAt == null) {
    await updateItem(item.id, { firstOpenedAt: Date.now() });
  }

  // Path 1: feed included full content — prefer the feed's own HTML over
  // a cached Readability extraction (which may have been extracted from the
  // linked URL when the feed didn't provide full content at parse time).
  if (item.html && item.html.length > 0) {
    return { bodyHtml: processLinks(item.html, item.link), extracted: true, extractionFailed: false };
  }

  // Path 2: cached Readability extract.
  if (item.extractedHtml != null && item.extractedHtml.length > 0) {
    return { bodyHtml: processLinks(item.extractedHtml, item.link), extracted: true, extractionFailed: false };
  }

  // Path 3: extract via Readability + proxy.
  const url = item.link;
  if (!url) {
    return { bodyHtml: item.excerpt, extracted: false, extractionFailed: true };
  }
  const result = await extractArticle(url, item.thumbnail ?? undefined);
  if (!result) {
    return { bodyHtml: item.excerpt, extracted: false, extractionFailed: true };
  }
  await updateItem(item.id, { extractedHtml: result.html });
  return { bodyHtml: processLinks(result.html, item.link), extracted: true, extractionFailed: false };
}

/**
 * Triggered after a refresh sweep. Evicts stale extracted content per the
 * retention policy. Safe to call from the scheduler on each tick; no-op
 * when nothing needs to be evicted.
 */
export async function runExtractionEviction(): Promise<void> {
  await runEviction();
}