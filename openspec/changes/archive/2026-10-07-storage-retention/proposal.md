## Why

Sift keeps every article in the browser indefinitely and does not ask for persistent storage.

- **Unbounded growth.** Articles are deleted only when their feed is unsubscribed. Every article, including the full HTML that full-content feeds provide, stays in IndexedDB on each device, although the article list shows at most the newest 500 for a selection. This costs disk space on the reader's device, and until `split-item-bodies` lands it also slows search, list queries and refreshes.
- **Loss of all local data.** Without persistent storage, a browser under storage pressure may clear the whole origin, and Safari deletes script-writable storage for sites that are not installed as web apps after seven days of browser use without interaction with the site. For a local-first reader this is the most damaging failure.

Persistent storage removes the quota as the limiting factor, so retention is about being considerate with the reader's disk, not about staying under a quota. Almost all of an article's size is its body; the remaining record (title, link, summary, dates, read and starred state) is small and is what search and history use. Retention can therefore remove most of the storage while keeping what readers are likely to look for again.

## What Changes

- **Request persistent storage.** Call `navigator.storage.persist()` after the first feed is added, from that user action, and again from Settings on request. Record the result rather than prompting repeatedly. Firefox shows a permission prompt; Chromium grants or refuses silently based on engagement and installation; installed web apps on Safari are already exempt from the seven-day rule. Retention rules do not depend on whether persistence is granted.
- **Track when each article was last seen in its feed.** Add `lastSeenAt` to articles, with an index, stamped whenever a browser refresh or a sync items pull includes the article. The migration sets existing articles to the migration time, so nothing becomes eligible for deletion until a full retention period after release.
- **Apply two levels of retention on each device**, measured from `lastSeenAt` so an article is never removed while its feed still lists it, and run in bounded batches after each refresh sweep:

  | Article | Body (`itemBodies`) | Record and flags |
  | --- | --- | --- |
  | Starred | Kept | Kept |
  | Read | Deleted after 90 days unseen | Kept |
  | Unread | Deleted after 90 days unseen | Deleted after 365 days unseen |

  Opening an article whose body has been deleted extracts it again from its link when online, as for a summary-only feed. Read records keep their flags and read markers, so search and reading history continue to work. Deleting an unread record also deletes its flag, since it holds no state worth keeping; if a feed republishes the article later it returns as a new unread article and counts again in reading statistics.
- **Retention is client-side.** Each device applies it to its own IndexedDB. Devices may remove the same article on different days; read and starred state stays consistent because it is held in flags. Server-side retention is unchanged: polled articles are kept for seven days and sync data is covered by `delete-sync-data`.
- **Show storage status in Settings.** Display usage and quota from `navigator.storage.estimate()`, whether storage is persistent, the number of stored articles and the number with bodies, with an action to request persistence when it is not granted.

## Capabilities

### New Capabilities

- `storage-retention`: persistent storage requests, article last-seen tracking, two-level age-based retention and the Settings storage status.

### Modified Capabilities

- `item-body-storage`: bodies may be deleted independently of their article records.

## Impact

`src/db/types.ts` and `src/db/open.ts` (`lastSeenAt`, its index and migration), `src/db/items.ts` (stamping in `bulkUpsertItems`, including `insertOnly` sync pulls, and batched retention deletes), `src/feeds/scheduler.ts`, the add-feed flow, `src/components/SettingsDrawer.tsx`, `AGENTS.md` (architecture note), README (the offline feature, and the search limitation that refers to evicted articles) and tests. No server changes and no new dependencies.

## Dependencies

- `split-item-bodies` must land first. It moves bodies into their own store, which makes body deletion a single-record delete, and removes the size-based eviction this change would otherwise replace.

## Decisions

- **Retention periods.** Remove unstarred bodies after 90 days unseen and unstarred unread records after 365 days unseen. These leave a long recovery window for infrequently opened feeds while removing the larger stored HTML first. Settings exposes counts and usage so a later change can use observed library size.
- **Read records.** Keep read records indefinitely. Their metadata is small and supports search, history and reading statistics; no time limit is introduced without evidence that the metadata is a meaningful storage cost.
- **When to request persistence.** Request once after the first feed is added; record the outcome to avoid repeated prompts. Settings provides an explicit retry action whenever the browser has not granted persistence.
- **Server flags.** Retain server flag behavior. Client retention is per device; the server does not know when an item was last present in a feed. Whole-account inactive and rotated-data retention is handled by `delete-sync-data`.
- **Schema migration.** Increment IndexedDB to version 11. Migrate version 10 in place by adding `lastSeenAt` and its index, stamping existing articles at migration time. Direct upgrades from version 9 also apply the body split and stamp. Earlier versions continue to reset as documented.

## Non-goals

Per-feed retention settings, a manual "clear old articles" action, offline storage of images, exporting deleted articles, and changes to server-side polling retention.
