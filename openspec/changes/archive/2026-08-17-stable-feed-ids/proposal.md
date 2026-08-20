## Why

The feed URL is currently the IndexedDB primary key, embedded in every item ID (`url::guid`), referenced by every flag, and used as the stable identifier in the sync protocol. This makes changing a feed URL impossible without a complex data migration. Users cannot edit a feed's name or update its URL when the source moves — two basic capabilities a feed reader should have.

Decoupling the feed's identity from its URL unlocks editable fields, simplifies the architecture, and makes the system more robust.

## What Changes

### Data model

- **BREAKING**: `Feed` gets a new `id` field (UUID generated at subscribe time, `crypto.randomUUID()`). The `id` becomes the IndexedDB primary key. `url` becomes a regular mutable field.
- **BREAKING**: `Item.id` changes from `${feedUrl}::${guid}` to `${feedId}::${guid}`. `Item.feedUrl` becomes `Item.feedId`.
- **BREAKING**: `ItemFlag.feedUrl` becomes `ItemFlag.feedId`.
- `Feed` gains `urlAt?: number | null` (sync timestamp for URL field) and `titleAt?: number | null` (sync timestamp for title field — currently implicit).
- `Feed` keeps `url`, `title`, `tags`, `htmlUrl`, etc. — all non-PK fields unchanged.

### Database

- **BREAKING**: IndexedDB schema v4 → v5. Migration deletes and recreates `feeds`, `items`, and `itemFlags` stores with new key paths and indexes.
  - `feeds`: keyed by `id` instead of `url`
  - `items`: index `by-feed-published` re-keyed from `['feedUrl', 'publishedAt']` to `['feedId', 'publishedAt']`
  - `itemFlags`: index `by-feed-url` re-keyed to `by-feed-id`
- Each existing feed gets `crypto.randomUUID()` assigned during migration. A `url→id` map is built to translate all items and flags.

### Sync protocol

- **BREAKING**: Server D1 `feeds` table PK changes from `(sync_key, feed_url)` to `(sync_key, feed_id)`. `feed_url` becomes a regular field with `feed_url_at` timestamp.
- **BREAKING**: Server D1 `flags` table `feed_url` column becomes `feed_id`.
- **BREAKING**: Wire format for feed entries changes: `feedUrl` → `feedId` in push payload, `feed_url` → `feed_id` in pull response. `feedUrl`/`feed_url` becomes an optional field.
- **BREAKING**: Wire format for flag entries changes: item IDs become `encodeURIComponent(feedId)::guid` instead of `encodeURIComponent(feedUrl)::guid`.
- **BREAKING**: Existing sync clients will fail to push/pull after server migration. Users must re-pair all devices.
- These breaking changes are acceptable at v0.x with few users.

### Feed management

- `subscribeFeed` generates a UUID (`crypto.randomUUID()`) and stores it as `feed.id`.
- New service function `changeFeedUrl(feedId, newUrl)` updates the `url` field, clears `etag`/`lastModified`, and enqueues a sync upsert with the new URL.
- New service function `changeFeedTitle(feedId, newTitle)` updates the `title` field and enqueues a sync upsert.
- `updateFeedTags` is unchanged (just works through `feed.id` now).

### User interface

- FeedEditorModal gains editable title field (debounced save) and editable URL field (save on blur with validation).
- Sidebar, river, settings dialogs reference feeds by `id` internally but display the same way to the user.
- Tag filtering and river scope work by `feedId` instead of `feedUrl`.

### Scheduler

- `refreshFeed(feed)` fetches from `feed.url`, tracks errors/fetching state by `feed.id`, and passes `feed.id` to `parsedToItems` for item ID construction.
- Item IDs remain stable for the feed's lifetime (even if URL changes).

## Capabilities

### New Capabilities

- `feed-identity`: Stable feed UUIDs decoupled from URLs. Covers the IDB schema change, migration, and how feeds/items/flags are referenced throughout the system. This is the architectural foundation.
- `feed-editor-fields`: Editable feed title and URL in the edit modal. Covers the UI components, service functions, validation, and save semantics (debounced title, blur-save URL with validation).

### Modified Capabilities

*(none — this is the first formal spec for this codebase)*

## Impact

| Area | Scope |
|------|-------|
| **Types** | `db/types.ts` — `Feed.id` added, `Feed.url` no longer PK, `Item.feedId` replaces `feedUrl`, `ItemFlag.feedId` replaces `feedUrl` |
| **DB layer** | `db/open.ts` — v5 migration. `db/feeds.ts` — keyed by id. `db/items.ts` — index re-keyed, queries by feedId. `db/flags.ts` — index re-keyed, queries by feedId |
| **Feed service** | `feeds/service.ts` — `subscribeFeed` generates UUID, `changeFeedUrl`, `changeFeedTitle` |
| **Scheduler** | `feeds/scheduler.ts` — track by feed.id. `feeds/parse.ts` — `parsedToItems` takes feedId |
| **Sync client** | `sync/queue.ts`, `sync/push.ts`, `sync/apply.ts`, `sync/merge.ts`, `sync/itemId.ts` — id-based wire format |
| **Sync server** | `server/sync/schema.ts` — DDL change. `server/sync/routes.ts` — push/pull handlers, validation |
| **State** | `state.tsx` — `riverScope` becomes `feedId \| null`, `feedMap` keyed by id, modal kinds carry feedId |
| **UI** | `Sidebar.tsx`, `FeedEditorModal.tsx`, `ConfirmUnsubscribeModal.tsx`, `River.tsx`, `AddFeedModal.tsx`, `SettingsDrawer.tsx` — id-based references |
| **Routing** | `routing.ts` — `itemUrl` hashes new item ID format. Existing `/i/<hash>` bookmarks break (see Risk) |
| **Tests** | ~8 test files updated for new types and wire format |
| **Documentation** | README updated if architecture description references feed URL as identity |

## Risks

### 1. Reading URL breakage (confirmed)

`itemUrl()` uses `hashId(item.id)` which hashes the full item ID string. After migration, item IDs change from `url::guid` to `feedId::uuid`. This produces a different hash. All existing `/i/<hash>` bookmarks, browser history entries, and shared links break.

**Options**:
- Accept at v0.x (recommended — few users, no known shared links)
- Hash the GUID only (gives permanent item URLs regardless of feed identity, but would change the hash format today — still breaks existing URLs)
- Build an old-hash→new-hash redirect map during migration (complex, probably not worth it at v0.x)

### 2. IDB migration failure

The v4→v5 migration deletes old stores and recreates them. If the browser crashes mid-migration, data loss is possible. IndexedDB upgrade transactions are atomic at the store level, but the migration involves reads+transforms+writes.

**Mitigation**: Read all old data into memory before deleting stores. If the read succeeds but the write fails, the upgrade transaction aborts and no data is lost (IDB rolls back). The user would retry on next load.

### 3. Sync protocol compatibility window

Old clients (pre-update) pushing with the old `feedUrl`-based format to the new server would fail validation (server expects `feedId`). Likewise, the server now returns `feed_id` in pull responses which old clients wouldn't recognize.

**Mitigation**: None needed. Users deploy the app bundle which includes both client and server code. Sync is same-origin (no third-party clients). The server migration and client update ship together.

### 4. Scope / missed references

The change touches ~25-30 files. The risk of missing a `feedUrl` → `feedId` rename in a query parameter or function argument is real.

**Mitigation**: TypeScript enforces much of this. The `Feed` type change from `url` as PK to `id` as PK will surface mismatches. A thorough review of all IndexedDB queries and index references is needed.
