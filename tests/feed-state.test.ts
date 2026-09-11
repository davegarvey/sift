import { describe, expect, it } from 'vitest';
import {
  clearSharedFeedFailure,
  getSharedFeedFailure,
  recordSharedFeedFailure,
} from '../server/feed-state';
import { runSyncCron } from '../server/sync/cron';
import { LocalD1Database } from '../server/sync/local-d1';
import { sha256Hex } from '../server/sync/tokens';

interface RowsResult {
  results: Record<string, unknown>[];
}

function createDatabase(): { local: LocalD1Database; db: D1Database } {
  const local = new LocalD1Database();
  return { local, db: local as unknown as D1Database };
}

describe('shared feed failure state', () => {
  it('bootstraps idempotently and stores only hashed failure metadata', async () => {
    const { local, db } = createDatabase();
    const upstream = 'https://example.com/private/feed.xml?token=secret';

    await recordSharedFeedFailure(db, upstream, { status: 419, retryAt: 1_000 }, 0);
    await recordSharedFeedFailure(db, upstream, { status: 503, retryAt: 2_000 }, 500);

    const rows = await local.prepare('SELECT * FROM feed_fetch_failures').all() as RowsResult;
    expect(rows.results).toEqual([{
      feed_key: await sha256Hex(upstream),
      status: 503,
      retry_at: 2_000,
      updated_at: 500,
    }]);
    expect(JSON.stringify(rows.results)).not.toContain(upstream);
    expect(JSON.stringify(rows.results)).not.toContain('secret');

    expect(await getSharedFeedFailure(db, upstream, 1_999)).toEqual({ status: 503, retryAt: 2_000 });
    expect(await getSharedFeedFailure(db, upstream, 2_000)).toBeUndefined();

    await clearSharedFeedFailure(db, upstream);
    const cleared = await local.prepare('SELECT * FROM feed_fetch_failures').all() as RowsResult;
    expect(cleared.results).toEqual([]);
  });

  it('deletes expired rows during the scheduled cleanup', async () => {
    const { local, db } = createDatabase();
    await recordSharedFeedFailure(db, 'https://example.com/expired.xml', { status: 419, retryAt: 1_000 }, 0);
    await recordSharedFeedFailure(db, 'https://example.com/active.xml', { status: 419, retryAt: 3_000 }, 0);

    await runSyncCron(db, 2_000);

    const rows = await local.prepare('SELECT * FROM feed_fetch_failures').all() as RowsResult;
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].retry_at).toBe(3_000);
  });
});
