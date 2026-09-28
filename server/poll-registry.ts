/**
 * Registry of feed URLs for server-side polling, shared by the sync routes
 * (which register new subscriptions) and the poller. Kept free of the feed
 * parser so the sync routes stay small.
 */

export const MAX_POLLED_FEEDS_PER_ACCOUNT = 500;
export const URL_CHUNK_SIZE = 500;

export function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export function registerStatement(pollDb: D1Database, feedUrls: string[], now: number): D1PreparedStatement {
  return pollDb
    .prepare(
      `INSERT INTO polled_feeds (feed_url, next_poll_at, updated_at)
       SELECT value, ?, ? FROM json_each(?) WHERE true
       ON CONFLICT (feed_url) DO NOTHING`,
    )
    .bind(now, now, JSON.stringify(feedUrls));
}

export async function registerPolledFeeds(pollDb: D1Database, feedUrls: string[], now = Date.now()): Promise<void> {
  const unique = [...new Set(feedUrls.filter((url) => url.length > 0))];
  if (unique.length === 0) return;
  await pollDb.batch(chunk(unique, URL_CHUNK_SIZE).map((urls) => registerStatement(pollDb, urls, now)));
}
