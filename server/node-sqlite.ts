import { DatabaseSync } from 'node:sqlite';
import type { SqliteConnection } from './sqlite-d1';

export function openNodeSqlite(path: string): SqliteConnection {
  return new DatabaseSync(path) as unknown as SqliteConnection;
}
