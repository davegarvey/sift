/**
 * Minimal D1 shim for local development.
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
 *
 * When constructed with a `persistPath`, the tables are loaded from that
 * file at startup and written back (debounced) on every mutation, so sync
 * state survives dev-server restarts — matching production D1.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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

    const mutating =
      upper.startsWith('CREATE TABLE') ||
      upper.startsWith('INSERT') ||
      upper.startsWith('UPDATE') ||
      upper.startsWith('DELETE') ||
      upper.startsWith('DROP TABLE') ||
      upper.startsWith('ALTER TABLE');
    if (mutating) this.db.schedulePersist();

    if (upper.startsWith('CREATE TABLE')) return this.db._createTable(trimmed);
    if (upper.startsWith('CREATE INDEX')) return [];
    if (upper.startsWith('INSERT')) return this.db._insert(trimmed, this.params);
    if (upper.startsWith('UPDATE')) return this.db._update(trimmed, this.params);
    if (upper.startsWith('DELETE')) return this.db._delete(trimmed, this.params);
    if (upper.startsWith('DROP TABLE')) return this.db._dropTable(trimmed);
    if (upper.startsWith('ALTER TABLE')) return this.db._alterTable(trimmed, this.params);
    if (upper.startsWith('SELECT')) return this.db._select(trimmed, this.params);

    throw new Error(`local-d1: unsupported SQL: ${trimmed.slice(0, 80)}`);
  }
}

export interface LocalD1Options {
  /** Optional JSON file to persist tables across restarts. */
  persistPath?: string;
}

export class LocalD1Database {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();
  /** Column defaults added via ALTER TABLE ... ADD COLUMN ... DEFAULT x. */
  private tableDefaults = new Map<string, Map<string, unknown>>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persisted = false;

  constructor(private options: LocalD1Options = {}) {
    if (options.persistPath) {
      this.loadFromDisk();
      process.once('beforeExit', () => {
        if (this.persisted && this.persistTimer) {
          clearTimeout(this.persistTimer);
          this.writeToDisk();
        }
      });
    }
  }

  private loadFromDisk(): void {
    try {
      const data = JSON.parse(readFileSync(this.options.persistPath!, 'utf8')) as {
        tables?: Record<string, Record<string, Record<string, unknown>>>;
        defaults?: Record<string, Record<string, unknown>>;
      };
      for (const [name, rows] of Object.entries(data.tables ?? {})) {
        this.tables.set(name, new Map(Object.entries(rows)));
      }
      for (const [name, cols] of Object.entries(data.defaults ?? {})) {
        this.tableDefaults.set(name, new Map(Object.entries(cols)));
      }
    } catch {
      // Missing or corrupt file — start with an empty database.
    }
  }

  private writeToDisk(): void {
    const path = this.options.persistPath!;
    const data = {
      tables: Object.fromEntries(
        [...this.tables].map(([name, rows]) => [name, Object.fromEntries(rows)]),
      ),
      defaults: Object.fromEntries(
        [...this.tableDefaults].map(([name, cols]) => [name, Object.fromEntries(cols)]),
      ),
    };
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, path);
  }

  /** Mark the persisted copy dirty; the next debounce flush writes it. */
  schedulePersist(): void {
    if (!this.options.persistPath) return;
    this.persisted = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.writeToDisk();
    }, 100);
  }

  prepare(sql: string): any {
    return new LocalD1Stmt(this, sql);
  }

  async batch(stmts: any[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const s of stmts) {
      out.push(s.run ? await s.run() : { results: [], success: true, meta: {} });
    }
    return out;
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

    // Parse the VALUES expression list — each element is either `?`
    // (consuming a param) or a literal (string, number, NULL).
    const row: Record<string, unknown> = {};
    const rawValues = valuesMatch
      ? valuesMatch[1].split(',').map((v) => v.trim())
      : [];
    let paramIdx = 0;
    for (let ci = 0; ci < columnNames.length; ci++) {
      const expr = rawValues[ci] ?? '';
      if (expr === '?') {
        row[columnNames[ci]] = params[paramIdx] ?? null;
        paramIdx++;
      } else if (expr === 'NULL') {
        row[columnNames[ci]] = null;
      } else if (/^\d+$/.test(expr)) {
        row[columnNames[ci]] = parseInt(expr, 10);
      } else if (expr.startsWith("'") && expr.endsWith("'")) {
        row[columnNames[ci]] = expr.slice(1, -1);
      } else {
        row[columnNames[ci]] = expr;
      }
    }

    // Build a key from primary key columns
    const pkCols = this._pkCols(tableName);
    const key = pkCols.map((c) => String(row[c] ?? '')).join('::');

    // Apply ALTER-added column defaults (e.g. pairing_codes.kind) to rows
    // that did not specify the column.
    const defaults = this.tableDefaults.get(tableName);
    if (defaults) {
      for (const [col, val] of defaults) {
        if (row[col] === undefined) row[col] = val;
      }
    }

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

    // Count `?` in the SET clause so we know where the WHERE params start.
    const setParamCount = (assignments.match(/\?/g) || []).length;

    const updated: Record<string, unknown>[] = [];

    // Special case: the monotonic counters table uses wall-anchored max
    // forms (`value = CASE WHEN value + 1 > ? THEN value + 1 ELSE ? END`
    // and `value = CASE WHEN ? > value THEN ? ELSE value END`) that the
    // generic CASE path would mis-apply (it treats the params as an at
    // pair and writes to a `value_at` column).
    if (tableName === 'counters' && /^value\s*=\s*CASE WHEN/.test(assignments.trim())) {
      for (const [, row] of table) {
        if (!this._matchesWhere(row, whereClause, params, setParamCount)) continue;
        const current = (row.value as number) ?? 0;
        const param = params[0] as number | undefined;
        if (param == null) continue;
        if (/value \+ 1 > \?/.test(assignments)) {
          row.value = Math.max(current + 1, param);
        } else {
          row.value = Math.max(current, param);
        }
        updated.push(row);
      }
      if (returningMatch) {
        return updated.length > 0 ? [updated[updated.length - 1]] : [];
      }
      return updated;
    }

    for (const [, row] of table) {
      if (!this._matchesWhere(row, whereClause, params, setParamCount)) continue;

      // Assemble CASE assignments into field sections so we can track
      // param consumption correctly. Each field section (folder/title/
      // deleted) contributes 2 case strings and 4 bind params:
      //   [at, value, at, at]
      // where each CASE consumes 2 params (at for comparison, value/at
      // for the THEN clause).
      const caseFields: string[] = [];
      const otherParts: string[] = [];
      for (const part of assignments.split(',')) {
        const trimmed = part.trim();
        if (/^\w+\s*=\s*CASE/i.test(trimmed)) {
          caseFields.push(trimmed);
        } else {
          otherParts.push(trimmed);
        }
      }
      let paramOffset = 0;
      for (let fi = 0; fi < caseFields.length; fi += 2) {
        const caseStr = caseFields[fi];      // field = CASE ...
        const atStr = caseFields[fi + 1];    // field_at = CASE ...
        this._applyCase(row, caseStr, params, paramOffset);
        paramOffset += 2; // at (comparison) + value
        if (atStr) {
          this._applyCase(row, atStr, params, paramOffset);
          paramOffset += 2; // at (comparison) + at (THEN)
        }
      }
      for (const trimmed of otherParts) {
        if (/^row_at\s*=\s*MAX/i.test(trimmed)) {
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
        } else {
          const eqMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
          if (eqMatch) {
            const col = eqMatch[1];
            const expr = eqMatch[2].trim();
            if (expr === 'NULL') {
              row[col] = null;
            } else if (expr.startsWith('?')) {
              row[col] = params[paramOffset] ?? null;
              paramOffset += 1;
            } else if (expr.startsWith("'")) {
              row[col] = expr.slice(1, -1);
            } else if (/^\w+\s*[+-]\s*\d+$/.test(expr)) {
              // Arithmetic: column + N or column - N
              const arith = expr.match(/^(\w+)\s*([+-])\s*(\d+)$/);
              if (arith) {
                const current = Number(row[arith[1]]) || 0;
                const delta = parseInt(arith[3], 10);
                row[col] = arith[2] === '+' ? current + delta : current - delta;
              }
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

  private _matchesWhere(
    row: Record<string, unknown>,
    whereClause: string,
    _params: unknown[],
    /** Number of SET params preceding the WHERE params in the bind array. */
    whereParamOffset = 0,
  ): boolean {
    const trimmed = whereClause.trim();
    if (!trimmed) return true;

    // Handle NOT conditions first
    const notMatch = trimmed.match(/^(\w+)\s+IS\s+NOT\s+NULL/i);
    if (notMatch) return row[notMatch[1]] != null;

    // Handle IS NULL
    const isNullMatch = trimmed.match(/^(\w+)\s+IS\s+NULL/i);
    if (isNullMatch) return row[isNullMatch[1]] == null;

    // Handle AND chains — track the param offset through each part.
    const parts = trimmed.split(/\s+AND\s+/i);
    let paramOffset = whereParamOffset;
    return parts.every((part) => {
      const result = this._paramMatch(row, part.trim(), _params, paramOffset);
      paramOffset = result.nextOffset;
      return result.matches;
    });
  }

  /** Match a single WHERE condition, consuming params starting at `offset`. */
  private _paramMatch(
    row: Record<string, unknown>,
    trimmed: string,
    _params: unknown[],
    offset: number,
  ): { matches: boolean; nextOffset: number } {
    // column = ?
    const eqMatch = trimmed.match(/^(\w+)\s*=\s*\?$/);
    if (eqMatch) {
      const col = eqMatch[1];
      return { matches: row[col] === _params[offset], nextOffset: offset + 1 };
    }

    // column != ?
    const neqMatch = trimmed.match(/^(\w+)\s*!=\s*\?$/);
    if (neqMatch) {
      const col = neqMatch[1];
      return { matches: row[col] !== _params[offset], nextOffset: offset + 1 };
    }

    // column > ?
    const gtMatch = trimmed.match(/^(\w+)\s*>\s*\?$/);
    if (gtMatch) {
      const col = gtMatch[1];
      return { matches: (row[col] as number) > (_params[offset] as number), nextOffset: offset + 1 };
    }

    // column < ?
    const ltMatch = trimmed.match(/^(\w+)\s*<\s*\?$/);
    if (ltMatch) {
      const col = ltMatch[1];
      return { matches: (row[col] as number) < (_params[offset] as number), nextOffset: offset + 1 };
    }

    // column = 1 (literal integer)
    const eqLit = trimmed.match(/^(\w+)\s*=\s*(\d+)$/);
    if (eqLit) {
      return { matches: row[eqLit[1]] === parseInt(eqLit[2]), nextOffset: offset };
    }

    // column IS NULL
    const isNullMatch = trimmed.match(/^(\w+)\s+IS\s+NULL$/i);
    if (isNullMatch) return { matches: row[isNullMatch[1]] == null, nextOffset: offset };

    // deleted = 1 (tombstone check)
    if (/^deleted\s*=\s*1$/.test(trimmed)) return { matches: row.deleted === 1, nextOffset: offset };

    return { matches: true, nextOffset: offset };
  }

  /**
   * Apply a single CASE assignment. Both ?s in the CASE consume params:
   * params[offset] is the comparison timestamp, params[offset + 1] is
   * the THEN value. The comparison operator (>, >=) is read from the SQL
   * so the deleted-field tie-break (tombstone wins equal stamps) matches
   * D1 semantics.
   */
  private _applyCase(
    row: Record<string, unknown>,
    sql: string,
    params: unknown[],
    offset: number,
  ): void {
    const fieldMatch = sql.match(/^(\w+)\s*=\s*CASE/i);
    if (!fieldMatch) return;
    const fieldName = fieldMatch[1];
    const atName = fieldName.endsWith('_at') ? fieldName : `${fieldName}_at`;
    const newAt = params[offset] as number | undefined;
    const newValue = params[offset + 1];
    if (newAt == null) return;
    const existingAt = row[atName] as number | null | undefined;
    const op = sql.match(/CASE\s+WHEN\s+\w+_at\s+IS\s+NULL\s+OR\s+\?\s*(>=|>)/i)?.[1] ?? '>';
    if (existingAt == null || (op === '>=' ? newAt >= existingAt : newAt > existingAt)) {
      row[fieldName] = newValue;
      row[atName] = newAt;
    }
  }

  _dropTable(sql: string): Record<string, unknown>[] {
    const m = sql.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i);
    if (!m) return [];
    this.tables.delete(m[1]);
    this.tableDefaults.delete(m[1]);
    return [];
  }

  /**
   * ALTER TABLE ... ADD COLUMN <col> <type> [DEFAULT <literal>] — the SQL
   * subset used by ensureSchema migrations. Adds the column to every
   * existing row and registers the default for future INSERTs.
   */
  _alterTable(sql: string, _params: unknown[]): Record<string, unknown>[] {
    const m = sql.match(
      /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+.*?(?:DEFAULT\s+(?:(?:'([^']*)')|(\d+)))?\s*$/i,
    );
    if (!m) return [];
    const tableName = m[1];
    const col = m[2];
    const table = this.tables.get(tableName);
    if (!table) return [];
    let defValue: unknown = null;
    if (m[3] !== undefined) defValue = m[3];
    else if (m[4] !== undefined) defValue = parseInt(m[4], 10);
    if (!this.tableDefaults.has(tableName)) this.tableDefaults.set(tableName, new Map());
    const defaults = this.tableDefaults.get(tableName)!;
    if (defaults.has(col)) return [];
    defaults.set(col, defValue);
    for (const row of table.values()) {
      if (row[col] === undefined) row[col] = defValue;
    }
    return [];
  }

  _pkCols(name: string): string[] {
    switch (name) {
      case 'users':
        return ['sync_key'];
      case 'feeds':
        return ['sync_key', 'feed_id'];
      case 'flags':
        return ['sync_key', 'item_id'];
      case 'pairing_codes':
        return ['code'];
      case 'tokens':
        return ['token_id'];
      case 'rate_limits':
        return ['scope', 'window_start'];
      case 'counters':
        return ['name'];
      default:
        return ['id'];
    }
  }
}
