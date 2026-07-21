## Context

The sync push handler currently uses a 3-statement PATCH pattern for item flags:

```
1. INSERT OR IGNORE INTO flags (...) VALUES (...)      — ensure row exists
2. UPDATE flags SET read = CASE ..., starred = CASE ... — conditional field update
3. UPDATE flags SET row_at = ?                          — update monotonic timestamp
```

This was designed for multi-writer conflict resolution (per-field last-writer-wins). Since Sift is single-user, two clients pushing conflicting flag state at the same time isn't a concern. The client always sends complete flag state (`read` + `starred` + both timestamps). The per-field PATCH adds overhead without benefit.

On the client side, `enqueueFlag()` appends a new entry to the dirty queue every time, even if a pending entry for the same item with the same state already exists. This can accumulate duplicates during rapid toggling or repeated calls.

## Goals / Non-Goals

**Goals:**
- Reduce D1 writes per flag from 3 statements to 1
- Prevent duplicate flag entries in the dirty queue for the same item+state
- Maintain correctness: no flag state is lost, no regressions in sync behavior

**Non-Goals:**
- Changing the D1 schema (flags table columns stay the same)
- Changing the pull response format (clients consume flags the same way)
- Adding full `lastPushedAt` tracking to `ItemFlag` in IndexedDB (may revisit later)
- Changing feed upsert patterns (feeds remain PATCH-based)

## Decisions

### Decision 1: INSERT OR REPLACE over UPSERT/PATCH

**Chosen:** `INSERT OR REPLACE INTO flags` with all fields in a single statement.

**Rationale:**
- Client always sends both `read` and `starred` with timestamps — complete state
- Single-user app has no concurrent write conflicts
- Replaces 3 round-trip-capable statements with 1; `row_at` set in the same pass
- Columns already exist in the D1 schema
- Simpler, faster, fewer D1 billing rows

**Rejected:**
- Keep the 3-statement PATCH — no benefit for single-user
- Use `UPSERT` (Postgres-style) — D1/SQLite doesn't support it natively; `INSERT OR REPLACE` is the SQLite idiom
- Use a batch of 3 smaller statements — same total billing rows

### Decision 2: Dirty-queue dedup over lastPushedAt on ItemFlag

**Chosen:** Check the in-memory dirty queue for existing entries with the same `itemId` and same `read`/`starred` values before appending. If values match, update timestamps in place. If values differ, replace the entry.

**Rationale:**
- No IndexedDB schema migration needed (no new fields on `ItemFlag`)
- No additional IndexedDB writes after push (no `lastPushedAt` to persist)
- Handles the practical case: rapid toggling of the same item
- If items toggle repeatedly, only the latest state is pushed

**Rejected:**
- Full `lastPushedAt` tracking on `ItemFlag` (requires DB_VERSION bump, 3 new fields, post-push IndexedDB writes — not justified by the actual dedup ratio for normal usage)
- Database-level dedup on the server — would require key-value snapshots

## Risks / Trade-offs

- **Backward compatibility**: Old client code (before this change) still sends both `read` and `starred`. The server change requires both fields to be present. Old clients always send both, so this is safe. No version negotiation needed.
- **Rollback**: If the server is rolled back to old code, it can still parse the flag payloads (the old PATCH code handles `read`/`starred` being present). Client dedup is purely additive — no data loss or corruption on rollback.
- **Deduplication lifetime**: The dirty queue is in-memory. If the page is reloaded mid-dedup, the queue is reloaded from IndexedDB (which has the entries before dedup was applied). Some duplicates might re-appear after reload. This is harmless (INSERT OR REPLACE on the server handles duplicates).

### Changes from Red Team Review

Issue #1 (contract drift) identified that `DirtyEntry` allows `read: 0|1|null` but the new server contract requires both fields. Fixed by:
- Narrowing `DirtyEntry.flag-update` to `read: 0 | 1` and `starred: 0 | 1`
- Removing conditional `if (e.read !== null)` / `if (e.starred !== null)` guards in `push.ts:44-45` — always emit both fields in the push payload
