# Design: fix-item-date-fallbacks

## Context

Today `parseDate` (src/feeds/parse.ts:181) stamps `Date.now()` when a feed entry has no parseable date, and the upsert merge (src/db/items.ts:50, :9) spreads the freshly parsed item over the stored one — so fallback-dated items get re-stamped to the refresh time on every fetch. Feed entries with *future* dates parse cleanly and render as "just now" too (`relativeTime` treats anything under 60s, including negative diffs, as "just now"; src/util/time.ts:5). Separately, a post-open `backfillFlags` mechanism (src/db/open.ts:39) with a `flagsBackfilled` meta key and runtime branches in `listUnreadAcrossFeeds`/`listStarred` (src/db/items.ts:143, :172) sits outside the versioned migration system (current `DB_VERSION = 6`). See proposal.md for motivation; specs/item-dates/spec.md defines the required behavior.

## Goals / Non-Goals

**Goals:**
- Fallback-dated items get a stable, honest date: first ingestion time, never the current time, never clobbered by refreshes.
- Fallback is explicit in the data model (`dateFallback`) so logic never needs to infer it.
- One-time v7 migration repairs already-stored future dates and absorbs the flags backfill; the `backfillFlags`/`flagsBackfilled` machinery is deleted.
- Unread/starred listings behave identically after the cleanup (they always used the flags store post-backfill).

**Non-Goals:**
- No shell-content detection or reading-view changes: SPA loader text renders as-is; the always-present "Open" CTA is the answer (user decision).
- No UI display of the fallback flag (data-only, available to MCP/CLI).
- No changes to sync semantics — items are never synced (sync/apply.ts ships feeds + flags only), so `dateFallback` is device-local.
- No change to how real feed dates behave.

## Decisions

### D1: Fallback value is first-seen time (`createdAt`), preserved on merge
`parseDate` returns `number | null` — null for missing, unparseable, **or future** dates (the future check lives in the parse layer, so every consumer shares one rule). `parsedToItems` resolves `publishedAt = p.publishedAt ?? createdAt` (with the same `now` becoming `createdAt`) and sets `dateFallback: true` when the fallback was used. The DB always stores a number (IndexedDB compound-key indexes skip records with null key components, which would silently drop items from the river index).

- *Alternative — sentinel `0`*: sorts items to the absolute bottom and renders "unknown" labels. Rejected: plausible river position is better than permanently-sunk items, and the sentinel leaks into sort/display code.
- *Alternative — clamp future dates to now*: still fabricates "now" and mislabels items; first-seen is honest.

### D2: Explicit `dateFallback` flag doubles as the merge discriminator
The merge rule (src/db/items.ts `bulkUpsertItems`, `insertOrUpdateItem`) becomes:

- Always preserve `existing.createdAt` and `existing.updatedAt`.
- When `incoming.dateFallback && existing.publishedAt <= Date.now()`: preserve `existing.publishedAt` **and** `existing.dateFallback` — the incoming fallback must never clobber a stored date, whether or not the stored item is itself flagged. (An existing *future* `publishedAt` fails the `<= Date.now()` clause and is replaced — this doubles as an on-refresh repair for any pre-migration residue.)
- Otherwise take the incoming values, writing `dateFallback: false` explicitly when the incoming date is real — the spread merge (`{ ...existing, ...item }`) alone can neither clear an existing flag (real-date items carry no key) nor preserve a stored date while keeping the stored flag state, so both must be written explicitly in every path.

- *Alternative — `incoming.publishedAt === incoming.createdAt` equality trick*: avoids the new field but is implicit and fragile. Rejected in favor of explicit state.
- Synced items (sync/apply.ts:159) always carry genuine dates with `dateFallback` unset, so they take the incoming value exactly as today.

### D3: The flags backfill becomes v7, not a meta-flag backfill
Bump `DB_VERSION` 6 → 7. Inside `if (_oldVersion < 7)` in the upgrade handler:
1. Future-date repair: for items with `publishedAt > Date.now()`, set `publishedAt = Math.min(item.createdAt ?? Date.now(), Date.now())` (the `??` guards items with a missing `createdAt` — `Math.min(undefined, …)` would produce `NaN`, which is not a valid IndexedDB key and would silently drop the record from every index) and `dateFallback = true`.
2. Flags backfill: for every item missing an `itemFlags` row, write one from `item.read`/`item.starred` (only-if-missing — never clobbers an existing flag row).
3. Cleanup: delete the stale `flagsBackfilled` meta key.

**Constraint:** the v7 block MUST operate through the upgrade transaction's stores (`transaction.objectStore('items')`, as the v5 block does) — idb's convenience methods (`db.get`/`db.put`/`db.delete`) open new transactions and throw `InvalidStateError` while a versionchange transaction is running.

Then delete `backfillFlags`, the `.then` post-open hook (src/db/open.ts:170), and the runtime branches in `listUnreadAcrossFeeds`/`listStarred`. Every item-write path (`bulkUpsertItems`, `insertOrUpdateItem`, sync `bulkSetFlags`/`updateItem`, v5) already keeps items and flags in lockstep, so post-v7 flag coverage is complete and the branches are provably dead.

- *Alternative — keep the meta-flag backfill (Option A)*: runs on every boot until a flag is set, history lives outside the version log, and the runtime checks remain. Rejected per user preference for a clean system: versioned migrations are one-shot, atomic, ordered, and self-documenting.
- *Alternative — leave old migration blocks untouched*: honored — v2/v3/v5/v6 blocks stay forever; IDB replays the chain from the user's actual `oldVersion`.

### D4: Extract the upgrade handler for testability
Move the inline `upgrade` callback in `getDb` (src/db/open.ts:67) into an exported `upgradeDb(db, oldVersion, newVersion, transaction)` so tests can open a seeded v6 database with `openDB(name, 6, …)`, close it, then reopen at v7 through the real handler. No behavior change.

### D5: Display guard, tooling parity
- `relativeTime` **and** `humanRelativeTime` (src/util/time.ts): "unknown" when `ts <= 0` **or** the diff is negative (`now - ts < 0`) — non-positive and future timestamps must never render as "just now". Unreachable in normal operation post-v7 (repair + fallback guarantee positive, past values), kept as defense against corrupt data and clock rollback. The reading-view byline uses `humanRelativeTime` (ReadingView.tsx:216), so both functions need the guard.
- `packages/siftctl/src/items.ts`: same `parseDate` → `number | null` (including future); entries with no usable date report "unknown" in output.
- `server/mcp.ts` `get_feed_items`: serializes a null `publishedAt` as JSON `null` instead of a fabricated timestamp (CLI "unknown" is the display form; null is the data form of the same rule).

## Risks / Trade-offs

- [Migration runs `Date.now()` inside a versionchange transaction] → The sweep is tiny and idempotent; a mid-migration failure aborts the upgrade, which IDB retries on next open. Worst case: app blocks boot until the migration succeeds — acceptable for a one-user tool with a trivial sweep.
- [Repaired date still future if `createdAt` itself is future (clock rollback)] → `Math.min(createdAt, Date.now())` at repair time guarantees a non-future value.
- [Merge keeps a stale date if a feed's real date changes] → Intended: `dateFallback` items are *first-seen* items; real incoming dates always win (flag unset), preserving today's behavior for genuinely dated entries.
- [v7 upgrade holds a write lock during backfill] → v5 already rewrote all rows in-upgrade; DB scale here is small (single user, IndexedDB).
- [idb convenience methods inside the upgrade callback] → Constrained out by design (D3): the v7 block uses only transaction-bound stores.
- [Cadence learning counts fallback dates as fresh publishes] → `refreshFeed` computes `lastItemPublishedAt` from freshly parsed items (scheduler.ts:145), so an undated feed with >10 items is polled at the 30-min floor forever. Pre-existing behavior, not a regression; the first-seen fix does not address it. Accepted as out of scope — noted here so it isn't mistaken for a bug introduced by this change.
- [siftctl/MCP output format change] → New field semantics only; consumers (the user) prefer honest "unknown" over a fabricated "now".

## Migration Plan

Single version bump shipped with the app; no staged rollout or feature flag needed. Rollback is moot: the repair is idempotent, the backfill is only-if-missing, and nothing is deleted from the versioned migration history. The `flagsBackfilled` meta key is a best-effort cleanup inside the same migration.

## Open Questions

None — deferred unknowns (exact siftctl output formatting) are cosmetic and can be settled during implementation without touching specs, approach, or tasks.
