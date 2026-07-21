## Why

The sync layer pushes item flags (read/starred state) with 3 D1 statements per flag — INSERT OR IGNORE, conditional UPDATE fields, then UPDATE row_at. On first-time setup or a re-push, this generates O(n) × 3 queries, which compounds when toggling sync multiple times. With Phase 3 of the architectural improvements (pull-first, no re-push on re-enable) already implemented, the remaining cost is the per-flag statement count and redundant enqueues.

## What Changes

**Phase 1 — Server: single-statement flag upsert**
- Replace the 3-statement PATCH pattern for flags with a single `INSERT OR REPLACE` in the push handler
- Require `read` and `starred` to always be present in flag payloads (they always are in practice)
- Reduces D1 writes per flag from 3 to 1 (-67%)

**Phase 2 — Client: deduplicate flag entries in dirty queue**
- Before appending a `flag-update` dirty entry, check if an entry for the same item already exists with the same `read`/`starred` values
- If found, update timestamps in-place instead of adding a duplicate
- No schema change required; purely an in-memory dedup

## Capabilities

### New Capabilities
- `flag-sync-optimization`: Wire-format and D1 query patterns for pushing and pulling item flags, including the INSERT OR REPLACE approach and dirty-queue deduplication.

### Modified Capabilities

None. No existing capability specs to change.

## Impact

- **Server**: `server/sync/routes.ts` — flag push block rewritten to use `INSERT OR REPLACE`. Flag payload validation tightened (both `read` and `starred` required).
- **Client**: `src/sync/queue.ts` — `enqueueFlag` gets dedup check before appending.
- **D1 schema**: Existing `flags` table unchanged (columns are the same, just queried differently).
- **Tests**: Existing sync pairing e2e tests cover the flag push path; they should continue to pass without modification.
