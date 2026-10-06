## Why

Each article is stored in IndexedDB as one object, and IndexedDB always returns whole objects. Article bodies (`html` from the feed and `extractedHtml` from Readability) make up nearly all of an article's size but are needed in only one place: `openItemForReading`, when an article is opened. Every other read path loads them anyway:

- **Search** walks every article newest first and loads each in full, although it matches only the title and summary.
- **The article list** reads full articles until it has up to 500 to show, and the UI keeps those 500 in memory, bodies included.
- **Each feed refresh** loads every stored article of that feed in full to merge the fetched entries.

The cost of each of these grows with the size of the library, and the bodies dominate it.

Size-based eviction of `extractedHtml` would also need rewriting to work across two stores. It no longer serves its purpose (see `storage-retention`), so this change removes it rather than adapting it.

## What Changes

- **Add an `itemBodies` object store** keyed by article ID, holding `feedId`, `html` and `extractedHtml`, with a `by-feed-id` index.
- **Remove `html` and `extractedHtml` from the `items` store and the `Item` type.** List, search, unread, starred and refresh queries then read only article metadata.
- **Migrate in the version 10 upgrade.** Move every existing body into `itemBodies` and strip it from the article record within the version-change transaction, streaming with a cursor rather than loading all articles into memory. After the upgrade, code reads only the new layout; there is no fallback to bodies on article records.
- **Write bodies alongside articles.** `bulkUpsertItems` writes metadata and bodies in the same transaction, for browser refreshes, the add-feed flow and sync item pulls. A fetched entry with feed HTML replaces the stored `html` and clears `extractedHtml`, as today.
- **Read bodies on open.** `openItemForReading` reads the article's body by ID, applies the existing order (feed HTML unless partial, then cached extraction, then a new extraction) and stores new extractions in `itemBodies`.
- **Delete bodies with their articles**, including when a feed is unsubscribed.
- **Remove size-based eviction:** `runEviction`, its scheduler call, `STORAGE_SOFT_CAP_RATIO`, `EVICTION_CHUNK_SIZE` and `tests/eviction.test.ts`. Bodies are 5–20 KB with images kept as `/img` URLs, so there is no eviction until `storage-retention` deletes old bodies by age.

## Capabilities

### New Capabilities

- `item-body-storage`: the separate body store, its migration, and the rule that only opening an article reads its body.

### Modified Capabilities

- `storage-eviction`: remove the soft-cap eviction, quota-aware cap, chunked eviction and metadata-preservation requirements; keep the requirements that extracted HTML uses `/img` URLs and that `/img` responses are cached for 30 days.
- `query-indexing` and `search-performance`: queries and search operate on article metadata without bodies.

## Impact

`src/db/types.ts`, `src/db/open.ts` (version 10 schema and migration), `src/db/items.ts` (writes, merges, deletion), `src/articles/service.ts`, `src/sync/merge.ts`, `src/components/AddFeedModal.tsx` (through `bulkUpsertItems`), `src/feeds/scheduler.ts`, `src/articles/eviction.ts` (removed), tests constructing `Item` values with bodies, the migration tests, and the `AGENTS.md` architecture note. The parser's partial-content check runs on parsed entries before storage and is unchanged. No server changes and no new dependencies.

## Open questions

- **Upgrade duration.** The migration runs in one version-change transaction, which blocks the database opening until it completes. A library of tens of thousands of articles should take seconds; this should be measured against a large generated library before release.
- **Historical upgrade steps.** `upgradeDb` still carries steps from version 2 onwards. Since installed clients update automatically, those steps could be collapsed in a separate cleanup, recreating the database for any client older than version 9.

## Non-goals

Changes to retention or deletion of old articles (`storage-retention`), a word index for search, and offline storage of images.
