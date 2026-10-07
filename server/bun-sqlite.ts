// @ts-expect-error — Bun provides this built-in module at runtime.
import { Database } from 'bun:sqlite';
import type { SqliteConnection } from './sqlite-d1';

export function openBunSqlite(path: string): SqliteConnection {
  return new Database(path, { create: true }) as unknown as SqliteConnection;
}
