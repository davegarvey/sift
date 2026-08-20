## 1. Data Model

- [x] 1.1 Add `id` field to `Feed` interface in `src/db/types.ts` — UUID PK, `url` becomes regular field
- [x] 1.2 Change `Item.feedUrl` → `Item.feedId` in `src/db/types.ts`
- [x] 1.3 Change `ItemFlag.feedUrl` → `ItemFlag.feedId` in `src/db/flags.ts`
- [x] 1.4 Add `titleAt?: number | null` and `urlAt?: number | null` to `Feed` for sync timestamps

## 2. IDB Migration

- [x] 2.1 Update `DB_VERSION` to 5 in `src/db/types.ts`
- [x] 2.2 Add v5 upgrade block in `src/db/open.ts`: read old data, assign UUIDs, delete old stores, create new stores with new key paths/indexes, write migrated data

## 3. DB Layer

- [x] 3.1 Update `src/db/feeds.ts`: all operations keyed by `id` instead of `url`. `upsertFeed`, `getFeedByUrl` → `getFeed`, `listFeeds`, `deleteFeed`, `updateFeed`. Add `getFeedByUrl` as url-lookup helper
- [x] 3.2 Update `src/db/items.ts`: rename index `by-feed-published` key from `['feedUrl', 'publishedAt']` to `['feedId', 'publishedAt']`. Update `listItemsByFeed`, `deleteItemsByFeed`, `bulkUpsertItems`, `insertOrUpdateItem` to use `feedId`
- [x] 3.3 Update `src/db/flags.ts`: rename index `by-feed-url` → `by-feed-id`. Update `deleteFlagsByFeed` and other queries

## 4. Feed Service

- [x] 4.1 Update `subscribeFeed` in `src/feeds/service.ts`: generate `crypto.randomUUID()`, store as `feed.id`
- [x] 4.2 Add `updateFeedMeta(feedId, { title?, tags? })` service function — generalized update for title/tags with sync enqueue
- [x] 4.3 Add `changeFeedUrl(feedId, newUrl)` service function — validates URL, updates `url` field, clears `etag`/`lastModified`, enqueues sync upsert
- [x] 4.4 Update `updateFeedTags` to delegate to `updateFeedMeta` (or replace with it)
- [x] 4.5 Update `unsubscribeFeed` to accept feed ID

## 5. Sync — Client

- [x] 5.1 Update `src/sync/itemId.ts`: `encodeItemId` takes `feedId` instead of `feedUrl`. `decodeItemId` returns `{ feedId, guid }` instead of `{ feedUrl, guid }`. Wires use `encodeURIComponent(feedId)::guid`
- [x] 5.2 Update `src/sync/queue.ts`: `DirtyEntry` for `feed-upsert` replaces `feedUrl` with `feedId`. `enqueueFeed` takes `feedId`. `enqueueFlag` uses `feedId` instead of `feedUrl`
- [x] 5.3 Update `src/sync/push.ts`: `chunkToBody` sends `feedId` in feed payload, sends `feedId` in flag payload. Item ID encoded with `feedId`. URL included as optional field with timestamp
- [x] 5.4 Update `src/sync/apply.ts`: `RemoteFeed` uses `feed_id` as identity, `feed_url` as optional field. `RemoteFlag` uses `feed_id`. Match local feeds by `id` instead of `url`
- [x] 5.5 Update `src/sync/merge.ts`: `runFirstTimeSetup` enqueues with `feedId`

## 6. Sync — Server

- [x] 6.1 Update `server/sync/schema.ts`: `feeds` table PK becomes `(sync_key, feed_id)`. `feed_url` becomes regular field with `feed_url_at`. `flags` table uses `feed_id`. Add schema version detection for drop+recreate
- [x] 6.2 Update `server/sync/routes.ts`: `FeedPayload` uses `feedId` as identity, `feedUrl` as optional field. `FlagPayload` uses `feedId`. Validation updated for new item ID format. Pull query returns `feed_id` in results

## 7. Scheduler

- [x] 7.1 Update `src/feeds/scheduler.ts`: `refreshFeed` uses `feed.id` for error tracking (`feedErrors`) and fetching state (`fetchingFeeds`). `parsedToItems` called with `feed.id` for item ID construction
- [x] 7.2 Update `src/feeds/parse.ts`: `parsedToItems` takes `feedId` instead of `feedUrl` parameter

## 8. State Management

- [x] 8.1 Update `src/state.tsx`: `riverScope` changes from `string | null` (feed URL) to `string | null` (feed ID). `feedMap` keyed by `id`. Modal kinds use `feedId` instead of `feedUrl`. Add `updateFeedMeta` and `changeFeedUrl` to context. Update `unsubscribeFeedCtx` to use feed ID. Update `subscribeFeedCtx` to use new service

## 9. UI Components

- [x] 9.1 Update `src/components/Sidebar.tsx`: `selectFeed` uses feed ID. `lastFeedUrl` settings → `lastFeedId`. `visibleFeeds` filter uses feed IDs. `FeedRow` uses feed ID for edit/open modal
- [x] 9.2 Update `src/components/River.tsx`: river scope filter compares `item.feedId` with `riverScope` (feed ID). Source display uses `feedMap().get(item.feedId)?.title`
- [x] 9.3 Update `src/components/ConfirmUnsubscribeModal.tsx`: use `feedId` instead of `feedUrl`
- [x] 9.4 Update `src/components/AddFeedModal.tsx`: subscribe flow uses new service with ID

## 10. Feed Editor Modal

- [x] 10.1 Add title text input with debounced save (500ms timer, calls `updateFeedMeta`)
- [x] 10.2 Add URL text input with blur validation (valid URL check + duplicate check, calls `changeFeedUrl`)
- [x] 10.3 Integrate existing `TagInput` (unchanged behavior)
- [x] 10.4 Clean up: remove `feedTitle` from modal kind — read from `feedMap` reactively

## 11. Tests

- [x] 11.1 Update `tests/feeds.test.ts` for new Feed type with `id`
- [x] 11.2 Update `tests/sync-d1.test.ts` for new wire format (feedId, itemId format)
- [x] 11.3 Update `tests/sync-client.test.ts` for new `applyRemoteState` types
- [x] 11.4 Update `tests/sync-queue.test.ts` for new `DirtyEntry` format
- [x] 11.5 Update `tests/add-feed.smoke.ts` for new service signatures

## 12. Cleanup

- [x] 12.1 Update README if architecture description references feed URL as identity (no references found)
- [x] 12.2 Search for any remaining `feedUrl`, `feed_url`, `by-feed-url` references missed in previous tasks (none found)
