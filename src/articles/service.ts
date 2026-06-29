import type { Item } from '../db/types';
import { getItem, updateItem } from '../db/items';
import { extractArticle, reinlineImages } from './extract';
import { runEviction } from './eviction';

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

  // Path 1: cached extract.
  if (item.extractedHtml != null && item.extractedHtml.length > 0) {
    return { bodyHtml: item.extractedHtml, extracted: true, extractionFailed: false };
  }

  // Path 2: feed included full content — use it directly without an upstream call.
  if (item.html && item.html.length > 0) {
    // Treat feed-supplied HTML as already extracted (no Readability pass needed).
    // Reading view renders it as-is.
    return { bodyHtml: item.html, extracted: true, extractionFailed: false };
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
  return { bodyHtml: result.html, extracted: true, extractionFailed: false };
}

/**
 * Lazily re-inline images for an item's body whose images have been evicted.
 * Called by the reading view as the user scrolls near images.
 */
export async function relininlineForItem(
  itemId: string,
  bodyHtml: string,
): Promise<string | null> {
  const item = await getItem(itemId);
  if (!item || item.extractedHtml == null) return null;
  const updated = await reinlineImages(bodyHtml);
  await updateItem(item.id, { extractedHtml: updated });
  return updated;
}

/**
 * Triggered after a refresh sweep. Evicts stale extracted content per the
 * retention policy. Safe to call from the scheduler on each tick; no-op
 * when nothing needs to be evicted.
 */
export async function runExtractionEviction(): Promise<void> {
  await runEviction();
}