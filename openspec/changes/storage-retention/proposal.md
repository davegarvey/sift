## Why

Sift's storage management targets a problem that no longer exists and leaves the real risks unaddressed.

Size-based eviction was introduced when extracted articles embedded their images as `data:` URIs, so each opened article could take several megabytes. It clears `extractedHtml` from the earliest-opened articles once usage exceeds 5% of the storage quota. Extracted HTML now keeps images as `/img` URLs and is roughly 5–20 KB per article. It exists only for articles opened from summary-only feeds, and can be extracted again on the next online open. The cap is rarely reachable through extracted HTML. When usage does exceed it for another reason, eviction clears all extracted HTML, remains over the cap, and rescans the whole items store after every refresh sweep.

Two risks are not covered:

- **Unbounded article growth.** Articles are deleted only when their feed is unsubscribed. Every article, including the full HTML that full-content feeds provide, stays in IndexedDB indefinitely, although the article list shows at most the newest 500 for a selection.
- **Loss of all local data.** Sift does not request persistent storage. A browser under storage pressure may clear the whole origin, and Safari deletes script-writable storage for sites that are not installed as web apps after seven days of browser use without interaction with the site. For a local-first reader this is the most damaging failure.

## What Changes

- **Request persistent storage.** Call `navigator.storage.persist()` after the first feed is added, from that user action, and again from Settings on request. Record the result rather than prompting repeatedly. Firefox shows a permission prompt; Chromium grants or refuses silently based on engagement and installation; installed web apps on Safari are already exempt from the seven-day rule.
- **Track when each article was last seen in its feed.** Add `lastSeenAt` to items, stamped whenever a browser refresh or a sync items pull includes the article. Existing items are given the migration time, so no article becomes eligible for deletion until a full retention period after release.
- **Delete old articles.** After each refresh sweep, delete articles that are not starred and have not been seen in their feed for the retention period: 90 days for read articles and 365 days for unread articles. Deletion keeps the article's read and starred flags and read markers, so an article that a feed later republishes returns with its previous state. Re-insertion currently increments the feed's `totalSeen` statistic, so it must recognise a previously deleted article and not count it again. Deletion runs in bounded batches through a `lastSeenAt` index rather than a full scan.
- **Remove size-based eviction.** Delete `runEviction`, its scheduler call, `STORAGE_SOFT_CAP_RATIO`, `EVICTION_CHUNK_SIZE` and their tests. Extracted HTML is deleted with its article and needs no separate limit.
- **Show storage status in Settings.** Display usage and quota from `navigator.storage.estimate()`, whether storage is persistent, and the number of stored articles, with an action to request persistence when it is not granted.

## Capabilities

### New Capabilities

- `storage-retention`: persistent storage requests, article last-seen tracking, age-based article deletion and the Settings storage status.

### Modified Capabilities

- `storage-eviction`: remove the soft-cap eviction, quota-aware cap, chunked eviction and metadata-preservation requirements; keep the requirements that extracted HTML uses `/img` URLs and that `/img` responses are cached for 30 days.

## Impact

`src/db/types.ts` and `src/db/open.ts` (new `lastSeenAt` field, `by-last-seen` index and migration), `src/db/items.ts` (stamping in `bulkUpsertItems`, including `insertOnly` sync pulls, and a batched deletion function that keeps flags and read markers), `src/feeds/scheduler.ts`, `src/articles/eviction.ts` and `tests/eviction.test.ts` (removed), the add-feed flow, `src/components/SettingsDrawer.tsx`, `AGENTS.md` (architecture note), README (the offline feature and the search limitation, which refers to evicted items) and tests. No server changes and no new dependencies.

The one-line chunk fix and eviction tests in the current docs PR become moot once eviction is removed; they reduce the damage the existing routine can do until then.

## Open questions

- **Retention periods.** 90 days for read and 365 days for unread articles are proposals. Measuring article counts and storage on a real library, which the Settings status makes possible, should confirm them before release. A per-feed override is out of scope.
- **Unread articles.** Deleting unread articles at all is a judgement about long-ignored feeds. The alternative is to keep unread articles indefinitely and accept that they dominate growth for readers who do not read everything.
- **When to request persistence.** After the first feed is added is proposed. Requesting at install time or only from Settings would avoid a Firefox prompt during onboarding.
- **Flag growth.** Item flags and read markers are kept after their articles are deleted so state survives republishing. They are small, but they also grow without limit. A much longer limit for flags of articles unseen for several years could follow later.

## Non-goals

Per-feed retention settings, a manual "clear old articles" action, storing images for offline reading, exporting deleted articles, and changes to server-side polling retention, which is already seven days.
