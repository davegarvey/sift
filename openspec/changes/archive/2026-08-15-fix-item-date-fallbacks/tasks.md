# Tasks: fix-item-date-fallbacks

## 1. Data model

- [x] 1.1 Add `dateFallback?: boolean` to `Item` in `src/db/types.ts` (no schema/version change yet)
- [x] 1.2 Bump `DB_VERSION` from 6 to 7 in `src/db/types.ts`

## 2. Parse layer

- [x] 2.1 Change `parseDate` in `src/feeds/parse.ts` to return `number | null` — null for missing, unparseable, **or future** dates (never `Date.now()`)
- [x] 2.2 In `parsedToItems`, resolve `publishedAt = p.publishedAt ?? createdAt` (where `now` is the same value written to `createdAt`), and set `dateFallback: true` when the fallback was used
- [x] 2.3 Mirror the `parseDate` → `number | null` change (including future dates) in `packages/siftctl/src/items.ts` and report entries with no usable date as "unknown" in CLI output
- [x] 2.4 In `get_feed_items` in `server/mcp.ts`, serialize a null `publishedAt` as JSON `null` (CLI "unknown" is the display form; null is the data form)

## 3. Migration v7

- [x] 3.1 Extract the inline upgrade callback in `src/db/open.ts` into an exported `upgradeDb(db, oldVersion, newVersion, transaction)`; `getDb` calls it unchanged in behavior
- [x] 3.2 Add `if (_oldVersion < 7)` block using **transaction-bound stores only** (`transaction.objectStore(...)`, as the v5 block does — idb convenience methods throw inside versionchange transactions): repair items with `publishedAt > Date.now()` → `publishedAt = Math.min(item.createdAt ?? Date.now(), Date.now())` and `dateFallback = true` (the `??` guard prevents `NaN` keys)
- [x] 3.3 Same block: backfill missing `itemFlags` rows from `item.read`/`item.starred` (only-if-missing)
- [x] 3.4 Same block: delete the stale `flagsBackfilled` meta key
- [x] 3.5 Delete `backfillFlags` and the `.then` post-open hook in `getDb`

## 4. Merge rules

- [x] 4.1 In `bulkUpsertItems` (src/db/items.ts): always preserve `existing.createdAt` and `existing.updatedAt`; when `incoming.dateFallback && existing.publishedAt <= Date.now()`, preserve `existing.publishedAt` **and** `existing.dateFallback`; otherwise take incoming values and write `dateFallback: false` explicitly when the incoming date is real (the spread merge alone cannot clear a flag — real-date items carry no key)
- [x] 4.2 Apply the same rule to `insertOrUpdateItem`

## 5. Remove flagsBackfilled machinery

- [x] 5.1 Drop the `flagsBackfilled` branch from `listUnreadAcrossFeeds` (src/db/items.ts) — always use the itemFlags path
- [x] 5.2 Drop the `flagsBackfilled` branch from `listStarred` — always use the itemFlags path

## 6. Display guard

- [x] 6.1 In `src/util/time.ts`, both `relativeTime` and `humanRelativeTime` return "unknown" when `ts <= 0` **or** the diff is negative (`now - ts < 0`) — non-positive and future timestamps never render as "just now" (the reading-view byline uses `humanRelativeTime`)

## 7. Tests

- [x] 7.1 Parse tests: missing date → `createdAt` fallback + flag; unparseable date → fallback + flag; future date → fallback + flag; valid past date → used, no flag
- [x] 7.2 Merge tests covering the full matrix: fallback-dated item keeps first-seen `publishedAt`/`createdAt`/`updatedAt` **and its flag** across refresh (incoming fallback, existing flagged); existing real date + incoming fallback keeps the real date **without setting the flag**; real incoming date updates `publishedAt` **and clears the flag**; existing future date + incoming fallback replaces the future date
- [x] 7.3 Migration tests (via `upgradeDb`): seed v6 DB with a future-dated item, an item missing its flag row, and an item with a missing `createdAt` → reopen at v7 → future date repaired to non-future value with flag set, flag row backfilled, valid items untouched, `flagsBackfilled` key gone, no `NaN`/invalid keys written
- [x] 7.4 Migration chain tests: upgrades from old versions 0 and 5 (v5 store restructure replay + v7 repair/backfill in the same versionchange transaction) and a fresh install at v7 all succeed
- [x] 7.5 Listing tests: `listUnreadAcrossFeeds`/`listStarred` return correct items without any meta flag (existing tests keep passing after branch removal)
- [x] 7.6 Display guard tests: `relativeTime`/`humanRelativeTime` return "unknown" for non-positive and future timestamps
- [x] 7.7 Run full suite: `npm run typecheck && npm run lint && npm test`

## 8. Docs and sweep

- [x] 8.1 Sweep README for stale references to date handling, `flagsBackfilled`, or DB versioning; update if found
- [x] 8.2 `openspec validate` passes; task summary notes any spec deviation
