import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openNodeSqlite } from '../server/node-sqlite';
import { createSelfHostedDatabases } from '../server/sqlite-d1';
import { createApp } from '../server/handle';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('self-hosted SQLite D1 adapter', () => {
  it('applies the shared sync and polling migrations and preserves them across reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sift-sqlite-'));
    directories.push(directory);
    const databases = await createSelfHostedDatabases(directory, openNodeSqlite);
    const sync = databases.sync as unknown as D1Database;
    const poll = databases.poll as unknown as D1Database;

    const syncMigrations = await sync.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>();
    const pollMigrations = await poll.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>();
    expect(syncMigrations.results.length).toBeGreaterThan(1);
    expect(pollMigrations.results).toEqual([{ name: '0001_feed_polling.sql' }]);

    await sync.prepare('INSERT INTO users (sync_key, created_at) VALUES (?, ?)')
      .bind('a'.repeat(22), 1)
      .run();
    const user = await sync.prepare('SELECT sync_key FROM users WHERE sync_key = ?').bind('a'.repeat(22)).first<{ sync_key: string }>();
    expect(user?.sync_key).toBe('a'.repeat(22));

    expect(await sync.prepare('SELECT COUNT(*) AS count FROM users').first<number>('count')).toBe(1);
    databases.sync.connection.close?.();
    databases.poll.connection.close?.();

    const reopened = await createSelfHostedDatabases(directory, openNodeSqlite);
    const restored = await (reopened.sync as unknown as D1Database)
      .prepare('SELECT sync_key FROM users WHERE sync_key = ?').bind('a'.repeat(22)).first<{ sync_key: string }>();
    expect(restored?.sync_key).toBe('a'.repeat(22));
    const app = createApp({ db: reopened.sync as unknown as D1Database });
    expect((await app.request('/sync/capabilities')).status).toBe(200);
    reopened.sync.connection.close?.();
    reopened.poll.connection.close?.();
  });

  it('rolls a batch back when any statement fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sift-sqlite-batch-'));
    directories.push(directory);
    const databases = await createSelfHostedDatabases(directory, openNodeSqlite);
    const sync = databases.sync as unknown as D1Database;
    const key = 'b'.repeat(22);

    await expect(sync.batch([
      sync.prepare('INSERT INTO users (sync_key, created_at) VALUES (?, ?)').bind(key, 1),
      sync.prepare('INSERT INTO missing_table (id) VALUES (?)').bind('fail'),
    ])).rejects.toThrow();
    expect(await sync.prepare('SELECT COUNT(*) AS count FROM users WHERE sync_key = ?').bind(key).first<number>('count')).toBe(0);
    databases.sync.connection.close?.();
    databases.poll.connection.close?.();
  });
});
