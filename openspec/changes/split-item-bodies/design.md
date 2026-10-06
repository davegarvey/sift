## Context

An article is one IndexedDB record in `items`. IndexedDB returns whole records, so a cursor over `items` also loads `html` (the feed's own content) and `extractedHtml` (Readability output), which make up nearly all of a record's size. Only `openItemForReading` needs them. Search, the article list, the unread and starred queries, and the merge step in `bulkUpsertItems` read them and discard them.

The database is at version 9. `upgradeDb` in `src/db/open.ts` still carries the steps for versions 2 to 9, including a version 5 step that deletes and recreates three stores. The schema is `feeds`, `items` (indexes `by-feed-published`, `by-guid`, `by-published`), `itemFlags`, `meta`, `feedStats` and `readMarkers`.

Sift is pre-production and installed clients update automatically, so the design favours forward-only changes: one migration, then code that reads only the new layout.

## Goals / Non-Goals

**Goals:**

- Remove article bodies from every read path except opening an article.
- Upgrade existing libraries once, without loading them into memory and in a time the reader can wait out.
- Keep write paths atomic: an article and its body change in one transaction.
- Release the database for an upgrade started in another tab, and tell the reader when that is impossible.

**Non-Goals:**

- Age-based retention, last-seen tracking and persistent storage (`storage-retention`).
- A word index for search, and offline storage of images.
- A migration modal or progress indicator.
- Preserving bodies of articles stored before the upgrade.
- Server changes.

## Decisions

### A separate `itemBodies` store keyed by article ID

`itemBodies` holds `{ id, feedId, html?, extractedHtml? }` with keyPath `id` and a `by-feed-id` index. `feedId` exists for the index: unsubscribing a feed and re-keying it during sync pairing both address bodies by feed. A body row exists only when at least one of the two fields is present; a summary-only article that has never been opened has no row.

`Item` loses `html` and `extractedHtml`. `extractedHtml` changes from `string | null` to an optional string on the body, so a cleared extraction is an absent key rather than `null`.

Alternative considered: keeping `html` on the record and moving only `extractedHtml`. Rejected because feed HTML from full-content feeds is as large as extractions and would still be loaded by every list and search.

### Parsed entries keep `html`; the write path splits it

The parser produces entries carrying `html`. `bulkUpsertItems` accepts `ItemInput`, defined as `Item & { html?: string }`, and splits the body from the metadata on write. `parsedItemToItem` returns `ItemInput`, and sync pulls reach the store through the same function. Nothing downstream of the store sees `html` on an `Item`.

### Merge rules for bodies

- A fetched entry with feed HTML writes a new body row containing that `html` and no `extractedHtml`. This keeps the rule that fresh feed HTML replaces a cached extraction.
- A fetched entry without feed HTML leaves any stored body untouched.
- With `insertOnly`, an existing article is skipped entirely, including its body.

The previous implementation spread the incoming record over the stored one, and the incoming record always carried `extractedHtml: null`, so every refresh of an existing article discarded its cached extraction whether or not the feed supplied HTML. The new rule is narrower: a cached extraction is dropped only when the feed supplies HTML to replace it. This is a deliberate change; extraction is the expensive step, and nothing requires discarding it when the feed has not changed.

### Reading order is unchanged, and extractions are written to the body store

`openItemForReading` loads the article and its body by ID, then applies the existing order: feed HTML unless `isPartialFeedContent`, then a cached extraction, then a new extraction. A new extraction is stored with a write that checks the article still exists in the same transaction, so an extraction finishing after an unsubscribe cannot leave an orphaned body. `updateItem` no longer handles body fields.

### Version 10 as the baseline, with an upgrade from version 9 that drops bodies

`upgradeDb` branches on the old version and no longer carries the version 2 to 9 steps:

- **0 (new database):** create the version 10 layout.
- **9:** create an empty `itemBodies`, then walk `items` with a cursor inside the version-change transaction and rewrite each record that has `html` or `extractedHtml` without those fields through `cursor.update`. Only one record is held at a time. No bodies are written. A failure aborts the version-change transaction, which leaves the database at version 9 with all data intact.
- **1 to 8:** delete every store and create the version 10 layout, empty. This discards settings and the sync key as well as articles. Version 9 has been current since 31 August 2026 and clients update automatically, so only a client unopened since then is affected. Sync restores feeds, flags and statistics if it was enabled. The owner has confirmed this.

Alternative considered: moving each body into `itemBodies` during the upgrade. It was implemented first and measured on a library of 30,000 articles with about 262 MB of body text (60% with 5-20 KB of feed HTML, 10% with an extraction), in headless Chromium:

| Version 9 to 10 upgrade | Median of 3 |
| --- | --- |
| Move bodies, awaiting each request | 75.5 s |
| Move bodies, requests issued without awaiting | 73.6 s |
| Drop bodies (strip only) | 29.7 s |

Issuing requests without awaiting, paging with `getAll` instead of a cursor and dropping the `items` indexes during the rewrite changed the time by at most 10 s in single runs. The cost is in IndexedDB itself: the upgrade has to read about 262 MB whatever it does with it, and copying it again about doubles the time. A 75 s wait with a loading message looks like a hang. Dropping is therefore the choice.

The consequence is that articles stored before the upgrade have no body. Feed HTML returns on the next refresh for articles that are still in their feed, because a fetched entry with feed HTML writes a body. Any other article is extracted again from its link on first open, as `openItemForReading` already does for a summary-only article. If the reader is offline, the article shows its excerpt until they next open it online. Offline reading of previously stored articles is lost once, at the upgrade.

Alternative considered: keeping the old steps so any version upgrades in place. Rejected because version 5 already rebuilds three stores, the older steps need a test seed for each version, and the clients that would use them are expected not to exist.

The upgrade reads and writes inside one transaction, so it cannot interleave with another tab. Its duration grows with the amount of stored body text, because the upgrade must read it. The measured median is 29.7 s for the 30,000-article library above.

### Tab coordination

`getDb()` passes two handlers to `openDB`:

- `blocking` runs in a tab holding an open connection when a newer version wants to upgrade. It closes the connection and reloads the page, so the reloaded tab opens the new version and the upgrade proceeds.
- `blocked` runs in the tab that wants to upgrade while other connections remain open. It sets the database status to `blocked`, and the river's loading message changes to ask the reader to close other Sift tabs.

Tabs already running version 9 have no `blocking` handler, so for the first upgrade the `blocked` message is the only mechanism.

The upgrade itself sets the status to `upgrading` when the upgrade callback starts for an existing database, and the river's loading message reads "Updating your library…". The status is module-level state with a subscription in `src/db/open.ts` and takes one of `idle`, `blocked` or `upgrading`; `River` reads it to choose the loading message. A blocked open never starts the upgrade, so the blocked message applies until the other tabs close and the upgrade message applies after, which gives the blocked message precedence. The status returns to `idle` when the open settles, whether it succeeds or fails. Boot already waits on the first database call, and the river shows its loading state until hydration completes, so no new UI surface is needed. A new database sets no status, because creating it is immediate.

### Size-based eviction is removed

`runEviction`, its scheduler call, `STORAGE_SOFT_CAP_RATIO`, `EVICTION_CHUNK_SIZE` and `tests/eviction.test.ts` go. Eviction cleared `extractedHtml` on article records in size order. Adapting it to two stores would maintain code that `storage-retention` replaces with age-based deletion. Until that change lands, bodies are kept, which costs 5 to 20 KB per article with images held as `/img` URLs.

### Feed re-keying moves bodies

`rekeyFeedId` rewrites article IDs when a feed adopts a sync identity. Bodies are keyed by article ID, so it must move them too; otherwise they would be orphaned and the articles would show no content. Where the target already holds a body, the target's fields take precedence, matching how article records merge.

## Risks / Trade-offs

- **Upgrade duration on a large library.** Median 29.7 s for 30,000 articles and about 262 MB of bodies, dominated by reading the bodies. Mitigated by streaming, a single transaction and the "Updating your library…" message. Libraries with more body text take proportionally longer.
- **Loss of offline copies.** Articles stored before the upgrade have no body until a refresh supplies feed HTML or the reader opens them online.
- **Blocked upgrade.** Until every older tab closes, the new tab stays on the loading message. Old tabs cannot be reached, so the message is the only remedy.
- **Reset of pre-version-9 databases deletes settings.** Accepted by the owner; affects only clients unopened for over a month.
- **An article without a body row.** Opening it extracts again, as for any summary-only article, including after an interrupted extraction.

## Migration Plan

Ship in one release. The first open after deployment migrates in place. There is no rollback path from version 10 to 9; a client that fails to upgrade stays on version 9 and keeps its data.
