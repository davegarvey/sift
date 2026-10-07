import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface SqliteRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  all(...values: unknown[]): unknown[];
  get(...values: unknown[]): unknown;
  run(...values: unknown[]): SqliteRunResult;
}

export interface SqliteConnection {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): unknown;
  close?(): void;
}

export class SqliteD1Statement {
  private values: unknown[] = [];

  constructor(private readonly db: SqliteD1Database, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values.map((value) => typeof value === 'boolean' ? Number(value) : value);
    return this;
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const row = this.db.connection.prepare(this.sql).get(...this.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const started = performance.now();
    const results = this.db.connection.prepare(this.sql).all(...this.values) as T[];
    const pageCount = this.db.connection.prepare('PRAGMA page_count').get() as { page_count?: number } | undefined;
    const pageSize = this.db.connection.prepare('PRAGMA page_size').get() as { page_size?: number } | undefined;
    return {
      success: true,
      results,
      meta: {
        duration: performance.now() - started,
        changes: 0,
        last_row_id: null,
        size_after: (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0),
        rows_read: results.length,
        rows_written: 0,
        changed_db: false,
      },
    } as unknown as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const started = performance.now();
    const result = this.db.connection.prepare(this.sql).run(...this.values);
    return {
      success: true,
      results: [],
      meta: {
        duration: performance.now() - started,
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
        size_after: 0,
        rows_read: 0,
        rows_written: Number(result.changes),
        changed_db: Number(result.changes) > 0,
      },
    } as unknown as D1Result<T>;
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const rows = this.db.connection.prepare(this.sql).all(...this.values) as Record<string, T>[];
    return rows.map((row) => Object.values(row) as T);
  }

  toJSON(): Record<string, unknown> {
    return { sql: this.sql, values: this.values };
  }

  execute<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.run<T>();
  }
}

export class SqliteD1Database {
  constructor(readonly connection: SqliteConnection) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this, query) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        results.push(await (statement as unknown as SqliteD1Statement).execute<T>());
      }
      this.connection.exec('COMMIT');
      return results;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    const started = performance.now();
    this.connection.exec(query);
    return { count: 0, duration: performance.now() - started };
  }

  async withSession<T>(callback: (session: D1DatabaseSession) => Promise<T>): Promise<T> {
    return callback(this as unknown as D1DatabaseSession);
  }
}

export interface SelfHostedDatabases {
  sync: SqliteD1Database;
  poll: SqliteD1Database;
}

export async function createSelfHostedDatabases(
  dataDirectory: string,
  open: (path: string) => SqliteConnection,
): Promise<SelfHostedDatabases> {
  const directory = resolve(dataDirectory);
  mkdirSync(directory, { recursive: true });
  const sync = new SqliteD1Database(open(join(directory, 'sift-sync.sqlite')));
  const poll = new SqliteD1Database(open(join(directory, 'sift-poll.sqlite')));
  await applyMigrations(sync, resolve('server/migrations'));
  await applyMigrations(poll, resolve('server/migrations-poll'));
  return { sync, poll };
}

export async function applyMigrations(db: SqliteD1Database, directory: string): Promise<void> {
  db.connection.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))');
  const applied = new Set((await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results.map(({ name }) => name));
  const files = readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    db.connection.exec('BEGIN IMMEDIATE');
    try {
      db.connection.exec(readFileSync(join(directory, name), 'utf8'));
      await db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name).run();
      db.connection.exec('COMMIT');
    } catch (error) {
      db.connection.exec('ROLLBACK');
      throw new Error(`Failed to apply ${name}`, { cause: error });
    }
  }
}
