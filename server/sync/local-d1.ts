/**
 * Minimal in-memory D1 shim for local development.
 *
 * Supports the SQL subset used by server/sync/routes.ts:
 * - CREATE TABLE IF NOT EXISTS
 * - INSERT (OR IGNORE)
 * - UPDATE with CASE + WHERE
 * - SELECT with WHERE, ORDER BY
 * - DELETE FROM with WHERE
 * - INSERT ... ON CONFLICT DO UPDATE
 * - UPDATE ... RETURNING
 *
 * Does NOT support: JOINs, subqueries, GROUP BY, etc.
 * For production-like testing, use `wrangler dev`.
 */

class LocalD1Stmt {
  private params: unknown[] = [];

  constructor(
    private db: LocalD1Database,
    private sql: string,
  ) {}

  bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }

  async first() {
    const rows = this._exec();
    return rows[0] ?? null;
  }

  async all() {
    return { results: this._exec(), success: true as const, meta: {} };
  }

  async run() {
    this._exec();
    return { results: [], success: true as boolean, meta: {} };
  }

  raw(): unknown[] {
    return [];
  }

  toJSON(): Record<string, unknown> {
    return {};
  }

  private _exec(): Record<string, unknown>[] {
    const trimmed = this.sql.trim();
    const upper = trimmed.toUpperCase();

    if (upper.startsWith('CREATE TABLE')) return this.db._createTable(trimmed);
    if (upper.startsWith('CREATE INDEX')) return [];
    if (upper.startsWith('INSERT')) return this.db._insert(trimmed, this.params);
    if (upper.startsWith('UPDATE')) return this.db._update(trimmed, this.params);
    if (upper.startsWith('DELETE')) return this.db._delete(trimmed, this.params);
    if (upper.startsWith('SELECT')) return this.db._select(trimmed, this.params);

    throw new Error(`local-d1: unsupported SQL: ${trimmed.slice(0, 80)}`);
  }
}

export class LocalD1Database {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();

  prepare(sql: string): any {
    return new LocalD1Stmt(this, sql);
  }

  async batch(stmts: any[]): Promise<unknown[]> {
    return stmts.map((s) => ({ results: [], success: true, meta: {} }));
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  async exec(_sql: string) {
    return { count: 0, duration: 0 };
  }

  async withSession(_fn: (session: any) => Promise<any>): Promise<any> {
    return _fn({});
  }

  _createTable(sql: string): Record<string, unknown>[] {
    const m = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
    if (!m) return [];
    const name = m[1];
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return [];
  }

  _insert(sql: string, params: unknown[]): Record<string, unknown>[] {
    const m = sql.match(/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(\w+)/i);
    if (!m) return [];
    const tableName = m[1];
    const table = this.tables.get(tableName);
    if (!table) return [];

    // Extract columns and values
    const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
    const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);

    // Handle ON CONFLICT DO UPDATE
    const isOnConflict = /ON\s+CONFLICT/i.test(sql);
    const isIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);

    // Extract return column for RETURNING
    const returningMatch = sql.match(/RETURNING\s+(\w+)/i);
    const returningCol = returningMatch ? returningMatch[1] : null;

    let columnNames: string[] = [];

    if (colsMatch) {
      columnNames = colsMatch[1].split(',').map((c) => c.trim().replace(/^['"`]|['"`]$/g, ''));
    } else {
      columnNames = ['row_at', 'value']; // fallback
    }

    const row: Record<string, unknown> = {};
    let paramIdx = 0;
    for (const c of columnNames) {
      row[c] = params[paramIdx] ?? null;
      paramIdx++;
    }

    // Build a key from primary key columns
    const pkCols = this._pkCols(tableName);
    const key = pkCols.map((c) => String(row[c] ?? '')).join('::');

    // Bump auto-increment for RETURNING
    if (returningCol === 'value' && tableName === 'counters') {
      const cur = table.get(key)?.value ?? 0;
      const newVal = (cur as number) + 1;
      for (const c of columnNames) row[c] = params[0] === 'server_time' ? params[1] ?? newVal : params[1] ?? params[0] ?? 0;
    }

    if (isOnConflict && table.has(key)) {
      // ON CONFLICT DO UPDATE — update existing row
      // The DO UPDATE SET clause has column_name = expression pairs
      const setClause = sql.split(/DO\s+UPDATE\s+SET\s+/i)[1]?.split(/\bWHERE\b/i)[0];
      if (setClause) {
        const assignments = setClause.split(',');
        for (const assign of assignments) {
          const parts = assign.trim().split(/\s*=\s*/);
          if (parts.length === 2) {
            const col = parts[0].trim();
            const val = parts[1].trim();
            if (val === 'count + 1') {
              const existing = table.get(key);
              row[col] = (existing?.[col] as number) + 1;
            }
          }
        }
      }
      // Copy existing fields, then apply new values
      const existing = table.get(key) ?? {};
      const merged = { ...existing, ...row };
      for (const col of columnNames) {
        if (row[col] !== undefined) merged[col] = row[col];
      }
      table.set(key, merged);
    } else if (isIgnore && table.has(key)) {
      // INSERT OR IGNORE — skip if exists
      return [];
    } else {
      table.set(key, row);
    }

    if (returningCol) {
      const stored = table.get(key);
      return stored ? [stored] : [];
    }

    return [];
  }

  _update(sql: string, params: unknown[]): Record<string, unknown>[] {
    const m = sql.match(/UPDATE\s+(\w+)/i);
    if (!m) return [];
    const tableName = m[1];
    const table = this.tables.get(tableName);
    if (!table) return [];

    // Extract SET clause
    const setMatch = sql.match(/SET\s+([\s\S]+?)\s+WHERE/i);
    if (!setMatch) return [];

    // Extract WHERE clause
    const whereParts = sql.split(/\bWHERE\b/i);
    const whereClause = whereParts[1] ?? '';

    // Parse assignments
    const assignments = setMatch[1];
    const returningMatch = sql.match(/RETURNING\s+(\w+)/i);
    const returningCol = returningMatch ? returningMatch[1] : null;

    const updated: Record<string, unknown>[] = [];

    for (const [, row] of table) {
      if (!this._matchesWhere(row, whereClause, params)) continue;

      const setParts = assignments.split(',');
      for (const part of setParts) {
        const trimmed = part.trim();
        if (/^row_at\s*=\s*MAX/i.test(trimmed)) {
          // row_at = MAX(...) — compute max of field_at columns
          const cols = trimmed.match(/COALESCE\((\w+),\s*(\d+)\)/g) ?? [];
          let max = 0;
          for (const c of cols) {
            const fieldMatch = c.match(/COALESCE\((\w+),\s*\d+\)/);
            if (fieldMatch) {
              const val = row[fieldMatch[1]] as number ?? 0;
              if (val > max) max = val;
            }
          }
          row.row_at = max;
        } else if (/^\w+\s*=\s*CASE/i.test(trimmed)) {
          // CASE WHEN field_at IS NULL OR ? > field_at THEN ? ELSE field END
          const fieldMatch = trimmed.match(/^(\w+)\s*=\s*CASE/i);
          if (fieldMatch) {
            const fieldName = fieldMatch[1];
            const atName = `${fieldName}_at`;

            // Read params: at, value pairs
            const paramSpec = trimmed.match(/(\?\s*>\s*\w+_at)/g);
            const atParamIdx = params.findIndex((p) => typeof p === 'number');
            const valueParamIdx = atParamIdx >= 0 ? atParamIdx : -1;

            if (atParamIdx >= 0 && typeof params[atParamIdx] === 'number') {
              const newAt = params[atParamIdx] as number;
              const newValue = params[valueParamIdx + 1] ?? params[atParamIdx + 1];
              const existingAt = row[atName] as number | null;

              if (existingAt == null || newAt > existingAt) {
                row[fieldName] = newValue;
                row[atName] = newAt;
              }
            }
          }
        } else {
          // Simple assignment: column = value
          const eqMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
          if (eqMatch) {
            const col = eqMatch[1];
            const expr = eqMatch[2].trim();
            if (expr === 'NULL') {
              row[col] = null;
            } else if (expr.startsWith('?')) {
              const idx = 0;
              row[col] = params[idx + 1] ?? params[idx] ?? null;
            } else if (expr.startsWith("'")) {
              row[col] = expr.slice(1, -1);
            } else {
              row[col] = expr;
            }
          }
        }
      }

      updated.push(row);
    }

    if (returningCol) {
      return updated.length > 0 ? [updated[updated.length - 1]] : [];
    }
    return updated;
  }

  _delete(sql: string, _params: unknown[]): Record<string, unknown>[] {
    const m = sql.match(/DELETE\s+FROM\s+(\w+)/i);
    if (!m) return [];
    const tableName = m[1];
    const table = this.tables.get(tableName);
    if (!table) return [];

    const whereParts = sql.split(/\bWHERE\b/i);
    if (whereParts.length < 2) {
      table.clear();
      return [];
    }

    const whereClause = whereParts[1];
    for (const [k, row] of Array.from(table.entries())) {
      if (this._matchesWhere(row, whereClause, _params)) {
        table.delete(k);
      }
    }
    return [];
  }

  _select(sql: string, params: unknown[]): Record<string, unknown>[] {
    const m = sql.match(/FROM\s+(\w+)/i);
    if (!m) return [];
    const tableName = m[1];
    const table = this.tables.get(tableName);
    if (!table) return [];

    const whereParts = sql.split(/\bWHERE\b/i);
    const whereClause = whereParts.length >= 2 ? whereParts[1].split(/\bORDER\s+BY\b/i)[0] : '';
    const orderPart = whereParts.length >= 2 ? whereParts[1].match(/ORDER\s+BY\s+(\w+)\s+(\w+)/i) : sql.match(/ORDER\s+BY\s+(\w+)\s+(\w+)/i);

    let rows = Array.from(table.values());

    if (whereClause) {
      rows = rows.filter((r) => this._matchesWhere(r, whereClause, params));
    }

    if (orderPart) {
      const field = orderPart[1];
      const dir = orderPart[2].toUpperCase() === 'DESC' ? -1 : 1;
      rows.sort((a, b) => ((a[field] as number) - (b[field] as number)) * dir);
    }

    return rows;
  }

  private _matchesWhere(row: Record<string, unknown>, whereClause: string, _params: unknown[]): boolean {
    const trimmed = whereClause.trim();
    if (!trimmed) return true;

    // Handle NOT conditions first
    const notMatch = trimmed.match(/^(\w+)\s+IS\s+NOT\s+NULL/i);
    if (notMatch) return row[notMatch[1]] != null;

    // Handle IS NULL
    const isNullMatch = trimmed.match(/^(\w+)\s+IS\s+NULL/i);
    if (isNullMatch) return row[isNullMatch[1]] == null;

    // Handle AND chains
    const parts = trimmed.split(/\s+AND\s+/i);
    return parts.every((part) => this._matchesWhereSimple(row, part, _params));
  }

  private _matchesWhereSimple(row: Record<string, unknown>, part: string, _params: unknown[]): boolean {
    const trimmed = part.trim();

    // column = ?
    const eqMatch = trimmed.match(/^(\w+)\s*=\s*\?$/);
    if (eqMatch) {
      const col = eqMatch[1];
      const idx = 0;
      return row[col] === _params[idx];
    }

    // column != ?
    const neqMatch = trimmed.match(/^(\w+)\s*!=\s*\?$/);
    if (neqMatch) {
      const col = neqMatch[1];
      const idx = 0;
      return row[col] !== _params[idx];
    }

    // column > ?
    const gtMatch = trimmed.match(/^(\w+)\s*>\s*\?$/);
    if (gtMatch) {
      const col = gtMatch[1];
      const idx = 0;
      return (row[col] as number) > (_params[idx] as number);
    }

    // column < ?
    const ltMatch = trimmed.match(/^(\w+)\s*<\s*\?$/);
    if (ltMatch) {
      const col = ltMatch[1];
      const idx = 0;
      return (row[col] as number) < (_params[idx] as number);
    }

    // column = 1 (literals)
    const eqLit = trimmed.match(/^(\w+)\s*=\s*(\d+)$/);
    if (eqLit) {
      return row[eqLit[1]] === parseInt(eqLit[2]);
    }

    // column IS NULL
    const isNullMatch = trimmed.match(/^(\w+)\s+IS\s+NULL$/i);
    if (isNullMatch) return row[isNullMatch[1]] == null;

    // deleted = 1 (tombstone check)
    if (/^deleted\s*=\s*1$/.test(trimmed)) return row.deleted === 1;

    return true;
  }

  private _pkCols(name: string): string[] {
    switch (name) {
      case 'users':
        return ['sync_key'];
      case 'feeds':
        return ['sync_key', 'feed_url'];
      case 'flags':
        return ['sync_key', 'item_id'];
      case 'pairing_codes':
        return ['code'];
      case 'rate_limits':
        return ['scope', 'window_start'];
      case 'counters':
        return ['name'];
      default:
        return ['id'];
    }
  }
}
