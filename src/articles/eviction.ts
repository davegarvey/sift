import type { Item } from '../db/types';
import {
  FULL_RETENTION_MS,
  TEXTONLY_RETENTION_MS,
  FEED_STORAGE_THRESHOLD_BYTES,
} from '../db/types';
import { listItemsByFeed, updateItem } from '../db/items';
import { listFeeds } from '../db/feeds';
import { stripImages } from './extract';

/**
 * Storage-eviction policy (see design D5b):
 *  - Items keep full extractedHtml (with inlined images) for 7 days after first open.
 *  - After 30 days OR when a feed's items exceed 50MB, strip images (text-only).
 *  - Under continued pressure, fully drop extractedHtml.
 *
 * The threshold is approximate: we sum each item's `extractedHtml` byte length
 * for a feed; if it crosses the threshold, we run a leave-one-stash pass.
 *
 * Idempotent and safe to run on every scheduler tick.
 */
export async function runEviction(): Promise<void> {
  const feeds = await listFeeds();
  await Promise.all(feeds.map((f) => evictFeed(f.url)));
}

async function evictFeed(feedUrl: string): Promise<void> {
  const items = await listItemsByFeed(feedUrl, { limit: 500 });
  const now = Date.now();

  // Pass 1: drop extractedHtml from items older than the text-only retention.
  for (const item of items) {
    if (item.extractedHtml == null) continue;
    const age = now - (item.firstOpenedAt ?? item.createdAt);
    if (age > TEXTONLY_RETENTION_MS) {
      await updateItem(item.id, { extractedHtml: null });
      item.extractedHtml = null;
    }
  }

  // Pass 2: strip images from items older than the full retention.
  for (const item of items) {
    if (item.extractedHtml == null) continue;
    const age = now - (item.firstOpenedAt ?? item.createdAt);
    if (age > FULL_RETENTION_MS && !looksTextOnly(item.extractedHtml)) {
      const stripped = stripImages(item.extractedHtml);
      await updateItem(item.id, { extractedHtml: stripped });
      item.extractedHtml = stripped;
    }
  }

  // Pass 3: under continued per-feed storage pressure, drop extractedHtml
  // from the oldest items until we fall below the threshold.
  let bytes = totalBytes(items);
  if (bytes <= FEED_STORAGE_THRESHOLD_BYTES) return;
  const sorted = [...items].sort((a, b) => a.publishedAt - b.publishedAt);
  for (const item of sorted) {
    if (bytes <= FEED_STORAGE_THRESHOLD_BYTES) break;
    if (item.extractedHtml == null) continue;
    bytes -= item.extractedHtml.length;
    await updateItem(item.id, { extractedHtml: null });
  }
}

function totalBytes(items: Item[]): number {
  let total = 0;
  for (const i of items) total += (i.extractedHtml ?? '').length;
  return total;
}

function looksTextOnly(html: string): boolean {
  return !/<img\s[^>]*src="data:/.test(html);
}