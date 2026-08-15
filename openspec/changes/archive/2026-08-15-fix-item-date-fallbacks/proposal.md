# Proposal: fix-item-date-fallbacks

## Why

Items whose feed entries lack a parseable publish date — or carry a future date — are stamped with `Date.now()`, so they render as "just now" and pin themselves to the top of the article list; the stamp is re-applied on every feed refresh (e.g. The Register's sponsored "paper" entries, whose pages are JS shells). The fallback date should be the time we first saw the item, not the last refresh time, and existing bogus dates must be repaired once.

## What Changes

- **Missing or future feed dates fall back to first-ingestion time.** When a feed entry has no usable publish date (missing/unparseable) or its date is in the future, the item's `publishedAt` becomes its `createdAt` (the first time sift saw it) instead of `Date.now()`.
- **Items record that the date was a fallback.** A new `dateFallback` flag is stored on the item so downstream logic can tell an estimated date from a real one.
- **Merges never re-stamp dates.** Refreshing a feed preserves the stored `publishedAt` and `createdAt` for fallback-dated items instead of overwriting them with the refresh time.
- **Existing bogus future dates are repaired once.** A one-time migration sets `publishedAt = createdAt` for any stored item with a future publish date.
- **Flags backfill becomes a versioned migration.** The post-open `backfillFlags` mechanism and its `flagsBackfilled` runtime checks are replaced by the versioned migration; unread/starred listings always use the flags store. (Behavior of those listings is unchanged — implementation cleanup.)
- **Display guard.** A non-positive `publishedAt` renders as "unknown" rather than "just now".
- **Tooling parity.** The siftctl CLI applies the same date parsing rules; the MCP `get_feed_items` tool reports unknown dates rather than a fabricated timestamp.

## Capabilities

### New Capabilities
- `item-dates`: how an item's publish timestamp is derived from feed data, stored on the item, and rendered — including the fallback-to-first-seen rule, the fallback flag, and the never-clobber merge guarantee.

### Modified Capabilities
<!-- none: device-sync and other existing specs are unaffected -->

## Impact

- `src/feeds/parse.ts` — `parseDate` returns `number | null`; `parsedToItems` applies the `createdAt` fallback and sets `dateFallback`
- `src/db/types.ts` — `DB_VERSION` bump (6 → 7); `Item.dateFallback` field
- `src/db/open.ts` — versioned migration v7 (future-date repair, flags backfill, stale meta key cleanup); `backfillFlags` and the post-open hook removed
- `src/db/items.ts` — merge rules preserve first-seen `publishedAt`/`createdAt`; `flagsBackfilled` branches removed
- `src/util/time.ts` — non-positive timestamp guard
- `packages/siftctl/src/items.ts` — date parsing parity
- `server/mcp.ts` — `get_feed_items` null-date handling
- Tests: parse fallbacks, merge semantics, v7 migration, listings without the meta flag
