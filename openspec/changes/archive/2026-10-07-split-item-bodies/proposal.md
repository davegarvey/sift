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
- **Make version 10 the schema baseline.** Replace the accumulated upgrade steps (versions 2 to 9) with one baseline: a new database is created directly in the version 10 layout; a version 9 database is upgraded once by creating an empty `itemBodies` store and stripping `html` and `extractedHtml` from every article record, streaming with a cursor within the version-change transaction; a database older than version 9 is deleted and recreated empty. Version 9 has been current since 31 August 2026 and installed clients update automatically, so only a client unopened since then loses local data, which sync restores if enabled. After the upgrade, code reads only the new layout; there is no fallback to bodies on article records.
- **Drop bodies during the upgrade instead of moving them.** IndexedDB returns whole records, so the upgrade must read every stored body whether it keeps it or not. Measured on 30,000 articles (about 262 MB of bodies), reading and stripping took a median of 29.7 s, and also copying the bodies into `itemBodies` took 75.5 s. Bodies are recoverable: feed HTML returns on the next refresh for articles still in their feed, and any other article is extracted again from its link the first time it is opened, which `openItemForReading` already does for an article without a body. The cost is that articles stored before the upgrade lose their offline copy until they are next opened online.
- **No migration UI beyond a loading message.** The upgrade runs once while the database opens, during which the app shows its existing loading state with the message "Updating your library…". There is no modal or progress indicator. If the open is blocked, the blocked message takes precedence.
- **Release the database for upgrades in other tabs.** Add a `blocking` handler that closes the connection and reloads the page when a newer version needs to upgrade, and a `blocked` handler that changes the loading message to ask the reader to close other Sift tabs, replaced by the upgrade message once the upgrade starts. Tabs already running version 9 have no `blocking` handler, so the first upgrade relies on that message.
- **Write bodies alongside articles.** `bulkUpsertItems` writes metadata and bodies in the same transaction, for browser refreshes, the add-feed flow and sync item pulls. A fetched entry with feed HTML replaces the stored `html` and clears `extractedHtml`, as today.
- **Read bodies on open.** `openItemForReading` reads the article's body by ID, applies the existing order (feed HTML unless partial, then cached extraction, then a new extraction) and stores new extractions in `itemBodies`.
- **Delete bodies with their articles**, including when a feed is unsubscribed.
- **Remove size-based eviction:** `runEviction`, its scheduler call, `STORAGE_SOFT_CAP_RATIO`, `EVICTION_CHUNK_SIZE` and `tests/eviction.test.ts`. Bodies are 5–20 KB with images kept as `/img` URLs, so there is no eviction until `storage-retention` deletes old bodies by age.

## Capabilities

### New Capabilities

- `item-body-storage`: the separate body store, the upgrade that drops existing bodies, and the rule that only opening an article reads its body.

### Modified Capabilities

- `storage-eviction`: remove the soft-cap eviction, quota-aware cap, chunked eviction and metadata-preservation requirements; keep the requirements that extracted HTML uses `/img` URLs and that `/img` responses are cached for 30 days.
- `query-indexing` and `search-performance`: queries and search operate on article metadata without bodies.

## Impact

`src/db/types.ts`, `src/db/open.ts` (version 10 baseline, the version 9 upgrade, and `blocked`/`blocking` handlers and the upgrade status), the loading message in `src/components/River.tsx`, `src/db/items.ts` (writes, merges, deletion), `src/articles/service.ts`, `src/sync/merge.ts`, `src/components/AddFeedModal.tsx` (through `bulkUpsertItems`), `src/feeds/scheduler.ts`, `src/articles/eviction.ts` (removed), tests constructing `Item` values with bodies, the historical migration tests in `tests/date-fallbacks.test.ts` (replaced by baseline creation, version 9 migration and pre-version 9 reset tests), and the `AGENTS.md` architecture note. The parser's partial-content check runs on parsed entries before storage and is unchanged. No server changes and no new dependencies.

## Open questions

None. The version 9 to 10 upgrade took a median of 29.7 s (runs of 29.0, 29.7 and 30.7 s) on a library of 30,000 articles, about 60% with 5-20 KB of feed HTML and 10% with 5-20 KB of extracted HTML, measured in headless Chromium from `openDB` to resolution. It is dominated by reading the stored bodies, which no layout of the upgrade avoids, so it scales with the amount of body text, not the number of articles. The upgrade message covers the wait.

## Non-goals

Changes to retention or deletion of old articles (`storage-retention`), a word index for search, and offline storage of images.
