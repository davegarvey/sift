import { nextMonotonicTime } from './monotonic';
import { assertNoUrlLog } from '../log';
import { decodeItemId } from '../../src/sync/itemId';
import { MAX_POLLED_FEEDS_PER_ACCOUNT, registerPolledFeeds } from '../poll-registry';

export interface FeedPayload {
  feedId: string;
  feedUrl?: string;
  htmlUrl?: string | null;
  folder?: string[] | null;
  title?: string;
  tags?: string[] | null;
  deleted?: 0 | 1;
}

export interface FlagPayload {
  itemId: string;
  feedId: string;
  read?: 0 | 1 | null;
  starred?: 0 | 1 | null;
}

export interface PushBody {
  feeds?: FeedPayload[];
  flags?: FlagPayload[];
}

export type ApplyPushResult =
  | { ok: true }
  | { ok: false; kind: 'invalid'; message: string; field: string }
  | { ok: false; kind: 'cap' };

/** True when a value is a legacy `{ value, at }` wrapper. */
export function isLegacyWrapper(v: unknown): v is { value: unknown; at: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateFeedPayload(f: FeedPayload): { message: string; field: string } | null {
  if (typeof f.feedId !== 'string' || !f.feedId) {
    return { message: 'feed.feedId must be a non-empty string', field: 'feedId' };
  }
  if (f.feedUrl !== undefined) {
    if (isLegacyWrapper(f.feedUrl)) {
      return { message: 'feed.feedUrl must not contain timestamps (server stamps all writes)', field: 'feedUrl' };
    }
    if (typeof f.feedUrl !== 'string') {
      return { message: 'feed.feedUrl must be a string', field: 'feedUrl' };
    }
  }
  if (f.htmlUrl !== undefined) {
    if (isLegacyWrapper(f.htmlUrl)) {
      return { message: 'feed.htmlUrl must not contain timestamps (server stamps all writes)', field: 'htmlUrl' };
    }
    if (f.htmlUrl !== null && typeof f.htmlUrl !== 'string') {
      return { message: 'feed.htmlUrl must be a string or null', field: 'htmlUrl' };
    }
  }
  if (f.folder !== undefined) {
    if (isLegacyWrapper(f.folder)) {
      return { message: 'feed.folder must not contain timestamps (server stamps all writes)', field: 'folder' };
    }
    if (f.folder !== null && !Array.isArray(f.folder)) {
      return { message: 'feed.folder must be an array or null', field: 'folder' };
    }
  }
  if (f.title !== undefined) {
    if (isLegacyWrapper(f.title)) {
      return { message: 'feed.title must not contain timestamps (server stamps all writes)', field: 'title' };
    }
    if (typeof f.title !== 'string') {
      return { message: 'feed.title must be a string', field: 'title' };
    }
  }
  if (f.tags !== undefined) {
    if (isLegacyWrapper(f.tags)) {
      return { message: 'feed.tags must not contain timestamps (server stamps all writes)', field: 'tags' };
    }
    if (f.tags !== null && !Array.isArray(f.tags)) {
      return { message: 'feed.tags must be an array or null', field: 'tags' };
    }
  }
  if (f.deleted !== undefined) {
    if (isLegacyWrapper(f.deleted)) {
      return { message: 'feed.deleted must not contain timestamps (server stamps all writes)', field: 'deleted' };
    }
    if (f.deleted !== 0 && f.deleted !== 1) {
      return { message: 'feed.deleted must be 0 or 1', field: 'deleted' };
    }
  }
  return null;
}

function validateFlagPayload(g: FlagPayload): { message: string; field: string } | null {
  if (typeof g.itemId !== 'string' || !g.itemId) {
    return { message: 'flag.itemId must be a non-empty string', field: 'itemId' };
  }
  const parsed = decodeItemId(g.itemId);
  if (!parsed) {
    return { message: 'flag.itemId must contain "::"', field: 'itemId' };
  }
  if (typeof g.feedId !== 'string' || g.feedId !== parsed.feedId) {
    return { message: 'flag.feedId does not match itemId', field: 'feedId' };
  }
  if (g.read !== undefined) {
    if (isLegacyWrapper(g.read)) {
      return { message: 'flag.read must not contain timestamps (server stamps all writes)', field: 'read' };
    }
    if (g.read !== null && g.read !== 0 && g.read !== 1) {
      return { message: 'flag.read must be 0, 1, or null', field: 'read' };
    }
  }
  if (g.starred !== undefined) {
    if (isLegacyWrapper(g.starred)) {
      return { message: 'flag.starred must not contain timestamps (server stamps all writes)', field: 'starred' };
    }
    if (g.starred !== null && g.starred !== 0 && g.starred !== 1) {
      return { message: 'flag.starred must be 0, 1, or null', field: 'starred' };
    }
  }
  return null;
}

export async function applyPush(
  db: D1Database,
  pollDb: D1Database | undefined,
  syncKey: string,
  body: PushBody,
): Promise<ApplyPushResult> {
  const feeds = Array.isArray(body.feeds) ? body.feeds : [];
  const flags = Array.isArray(body.flags) ? body.flags : [];
  if (feeds.length === 0 && flags.length === 0) {
    return { ok: true };
  }

  // Validate payloads up front (all-or-nothing before any reads or writes).
  for (const f of feeds) {
    const err = validateFeedPayload(f);
    if (err) return { ok: false, kind: 'invalid', message: err.message, field: err.field };
  }
  for (const g of flags) {
    const err = validateFlagPayload(g);
    if (err) return { ok: false, kind: 'invalid', message: err.message, field: err.field };
  }

  // D5/D6 pre-pass: resolve the URL for each deleted feed — payload URL
  // wins over the stored row's URL (a server-stamped payload is always
  // newer), with the DB as fallback for legacy URL-less deletes. The
  // results build both the sibling-tombstone set (D5) and the in-batch
  // tombstone map (D6).
  const deleteIds = feeds.filter((f) => f.deleted === 1).map((f) => f.feedId);
  const rowUrlInfo = new Map<string, { url: string | null }>();
  if (deleteIds.length > 0) {
    const placeholders = deleteIds.map(() => '?').join(', ');
    const res = await db
      .prepare(`SELECT feed_id, feed_url FROM feeds WHERE sync_key = ? AND feed_id IN (${placeholders})`)
      .bind(syncKey, ...deleteIds)
      .all();
    for (const r of res.results as Array<{ feed_id: string; feed_url: string | null }>) {
      rowUrlInfo.set(r.feed_id, { url: r.feed_url ?? null });
    }
  }
  const siblingUrlByDelete = new Map<string, string>();
  for (const f of feeds) {
    if (f.deleted !== 1) continue;
    const url = f.feedUrl ?? rowUrlInfo.get(f.feedId)?.url ?? null;
    if (url) siblingUrlByDelete.set(f.feedId, url);
  }
  const inBatchTombstones = new Map<string, string>();
  for (const f of feeds) {
    if (f.deleted !== 1) continue;
    const url = siblingUrlByDelete.get(f.feedId);
    if (url && !inBatchTombstones.has(url)) inBatchTombstones.set(url, f.feedId);
  }

  // D6 routing: a subscribe (deleted: 0 + feedUrl) revives the oldest
  // tombstoned row for the URL under its existing feed_id — the in-batch
  // map first (a tombstone created earlier in this batch is invisible to
  // the DB), then the DB's oldest tombstone.
  const effectiveFeedId = new Map<number, string>();
  let d6Routed = 0;
  for (let i = 0; i < feeds.length; i++) {
    const f = feeds[i];
    if (f.deleted !== 0 || f.feedUrl === undefined) continue;
    const revived = inBatchTombstones.get(f.feedUrl)
      ?? (await db
        .prepare('SELECT feed_id FROM feeds WHERE sync_key = ? AND feed_url = ? AND deleted = 1 ORDER BY row_at ASC LIMIT 1')
        .bind(syncKey, f.feedUrl)
        .first<{ feed_id: string }>())?.feed_id;
    if (revived && revived !== f.feedId) {
      effectiveFeedId.set(i, revived);
      d6Routed++;
    }
  }

  // Per-user row cap check (D6-routed subscribes insert no rows; tombstones are transient).
  const [feedCount, flagCount] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM feeds WHERE sync_key = ? AND deleted = 0').bind(syncKey).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM flags WHERE sync_key = ?').bind(syncKey).first<{ n: number }>(),
  ]);
  const projectedFeeds = (feedCount?.n ?? 0) + feeds.length - d6Routed;
  const projectedFlags = (flagCount?.n ?? 0) + flags.length;
  if (projectedFeeds > 10_000 || projectedFlags > 1_000_000) {
    return { ok: false, kind: 'cap' };
  }

  // Assign the server monotonic batch time BEFORE building statements:
  // every row touched by this batch shares one row_at (delivery once per
  // batch, arrival-ordered).
  const batchT = await nextMonotonicTime(db);

  // Build batch.
  const stmts: D1PreparedStatement[] = [];

  for (let i = 0; i < feeds.length; i++) {
    const f = feeds[i];
    const fId = effectiveFeedId.get(i) ?? f.feedId;

    // Step 1: insert new row (a no-op for existing rows, including D6-revived ids).
    stmts.push(
      db
        .prepare('INSERT OR IGNORE INTO feeds (sync_key, feed_id, row_at) VALUES (?, ?, 0)')
        .bind(syncKey, fId),
    );

    // Step 2: clear tombstone — only on an explicit subscribe signal
    // (deleted: 0). A deleted: 1 push never clears (the PATCH below is
    // LWW-correct and must not regress a newer tombstone's deleted_at).
    if (f.deleted !== undefined && f.deleted === 0) {
      stmts.push(
        db
          .prepare(
            'UPDATE feeds SET deleted = 0, deleted_at = NULL WHERE sync_key = ? AND feed_id = ? AND deleted = 1',
          )
          .bind(syncKey, fId),
      );
    }

    // Step 3: per-field PATCH. Every field is stamped by the server with
    // the batch time (no client timestamps exist in the protocol). The
    // deleted field compares with >= so a tombstone wins equal stamps
    // (an in-batch subscribe then delete leaves no live row).
    const fieldSets: string[] = [];
    const fieldBinds: unknown[] = [];
    if (f.feedUrl !== undefined) {
      fieldSets.push(
        "feed_url = CASE WHEN feed_url_at IS NULL OR ? > feed_url_at THEN ? ELSE feed_url END",
        "feed_url_at = CASE WHEN feed_url_at IS NULL OR ? > feed_url_at THEN ? ELSE feed_url_at END",
      );
      fieldBinds.push(batchT, f.feedUrl);
      fieldBinds.push(batchT, batchT);
    }
    if (f.folder !== undefined) {
      fieldSets.push(
        "folder = CASE WHEN folder_at IS NULL OR ? > folder_at THEN ? ELSE folder END",
        "folder_at = CASE WHEN folder_at IS NULL OR ? > folder_at THEN ? ELSE folder_at END",
      );
      fieldBinds.push(batchT, f.folder === null ? null : JSON.stringify(f.folder));
      fieldBinds.push(batchT, batchT);
    }
    if (f.title !== undefined) {
      fieldSets.push(
        "title = CASE WHEN title_at IS NULL OR ? > title_at THEN ? ELSE title END",
        "title_at = CASE WHEN title_at IS NULL OR ? > title_at THEN ? ELSE title_at END",
      );
      fieldBinds.push(batchT, f.title);
      fieldBinds.push(batchT, batchT);
    }
    if (f.htmlUrl !== undefined) {
      fieldSets.push(
        "html_url = CASE WHEN html_url_at IS NULL OR ? > html_url_at THEN ? ELSE html_url END",
        "html_url_at = CASE WHEN html_url_at IS NULL OR ? > html_url_at THEN ? ELSE html_url_at END",
      );
      fieldBinds.push(batchT, f.htmlUrl);
      fieldBinds.push(batchT, batchT);
    }
    if (f.tags !== undefined) {
      fieldSets.push(
        "tags = CASE WHEN tags_at IS NULL OR ? > tags_at THEN ? ELSE tags END",
        "tags_at = CASE WHEN tags_at IS NULL OR ? > tags_at THEN ? ELSE tags_at END",
      );
      fieldBinds.push(batchT, f.tags === null ? null : JSON.stringify(f.tags));
      fieldBinds.push(batchT, batchT);
    }
    if (f.deleted !== undefined) {
      fieldSets.push(
        "deleted = CASE WHEN deleted_at IS NULL OR ? >= deleted_at THEN ? ELSE deleted END",
        "deleted_at = CASE WHEN deleted_at IS NULL OR ? >= deleted_at THEN ? ELSE deleted_at END",
      );
      fieldBinds.push(batchT, f.deleted);
      fieldBinds.push(batchT, batchT);
    }
    stmts.push(
      db
        .prepare(
          `UPDATE feeds SET ${fieldSets.join(', ')} WHERE sync_key = ? AND feed_id = ?`,
        )
        .bind(...fieldBinds, syncKey, fId),
    );
    stmts.push(
      db
        .prepare('UPDATE feeds SET row_at = ? WHERE sync_key = ? AND feed_id = ? AND ? > COALESCE(row_at, 0)')
        .bind(batchT, syncKey, fId, batchT),
    );
    assertNoUrlLog(f.feedUrl ?? '');
    assertNoUrlLog(f.htmlUrl ?? '');
  }

  // D5: tombstone every row sharing a deleted feed's URL. One UPDATE per
  // unique URL. The deleted comparison uses >= so an in-batch subscribe
  // that created a row under the URL is also tombstoned (ties win for
  // tombstones). Column order deleted, deleted_at, row_at is load-bearing:
  // the dev D1 shim pairs CASE fields positionally.
  for (const url of siblingUrlByDelete.values()) {
    assertNoUrlLog(url);
    stmts.push(
      db
        .prepare(
          'UPDATE feeds SET deleted = CASE WHEN deleted_at IS NULL OR ? >= deleted_at THEN ? ELSE deleted END, deleted_at = CASE WHEN deleted_at IS NULL OR ? >= deleted_at THEN ? ELSE deleted_at END, row_at = CASE WHEN ? > row_at THEN ? ELSE row_at END WHERE sync_key = ? AND feed_url = ? AND feed_id != ?',
        )
        .bind(batchT, 1, batchT, batchT, batchT, batchT, syncKey, url, inBatchTombstones.get(url) ?? ''),
    );
  }

  for (const g of flags) {
    stmts.push(
      db
        .prepare('INSERT OR IGNORE INTO flags (sync_key, item_id, feed_id, ever_read, row_at) VALUES (?, ?, ?, 0, 0)')
        .bind(syncKey, g.itemId, g.feedId),
    );

    const fieldSets: string[] = [];
    const fieldBinds: unknown[] = [];
    if (g.read !== undefined) {
      fieldSets.push(
        "read = CASE WHEN read_at IS NULL OR ? > read_at THEN ? ELSE read END",
        "read_at = CASE WHEN read_at IS NULL OR ? > read_at THEN ? ELSE read_at END",
      );
      fieldBinds.push(batchT, g.read);
      fieldBinds.push(batchT, batchT);
    }
    if (g.starred !== undefined) {
      fieldSets.push(
        "starred = CASE WHEN starred_at IS NULL OR ? > starred_at THEN ? ELSE starred END",
        "starred_at = CASE WHEN starred_at IS NULL OR ? > starred_at THEN ? ELSE starred_at END",
      );
      fieldBinds.push(batchT, g.starred);
      fieldBinds.push(batchT, batchT);
    }
    stmts.push(
      db
        .prepare(`UPDATE flags SET ${fieldSets.join(', ')} WHERE sync_key = ? AND item_id = ?`)
        .bind(...fieldBinds, syncKey, g.itemId),
    );
    stmts.push(
      db
        .prepare('UPDATE flags SET row_at = ? WHERE sync_key = ? AND item_id = ? AND ? > COALESCE(row_at, 0)')
        .bind(batchT, syncKey, g.itemId, batchT),
    );
    if (g.read === 1) {
      stmts.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO feed_stats (sync_key, feed_id, total_seen, read_once, row_at) VALUES (?, ?, 0, 0, 0)',
          )
          .bind(syncKey, g.feedId),
      );
      stmts.push(
        db
          .prepare('UPDATE flags SET ever_read = ?, row_at = ? WHERE sync_key = ? AND item_id = ? AND ever_read = 0')
          .bind(1, batchT, syncKey, g.itemId),
      );
      stmts.push(
        db
          .prepare(
            'UPDATE feed_stats SET read_once = read_once + 1, total_seen = CASE WHEN total_seen < read_once + 1 THEN read_once + 1 ELSE total_seen END, row_at = ? WHERE sync_key = ? AND feed_id = ? AND changes() = 1',
          )
          .bind(batchT, syncKey, g.feedId),
      );
    }
    assertNoUrlLog(g.feedId);
  }

  await db.batch(stmts);

  const subscribedUrls = feeds.flatMap((f) => (f.deleted === 0 && f.feedUrl ? [f.feedUrl] : []));
  if (pollDb && subscribedUrls.length > 0 && projectedFeeds <= MAX_POLLED_FEEDS_PER_ACCOUNT) {
    try {
      await registerPolledFeeds(pollDb, subscribedUrls);
    } catch {
      // The daily poll maintenance registers the URL instead.
    }
  }
  return { ok: true };
}
