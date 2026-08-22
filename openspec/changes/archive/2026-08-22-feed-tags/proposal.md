## Why

Feeds currently have only a flat list with no organizational primitives beyond a single-feed scope. Users with many feeds need lightweight labels to group related feeds and filter the river by topic. The existing `folder` field (from OPML import) is never exposed in the UI — dead weight.

## What Changes

- **New `tags` field on `Feed`**: an array of user-assigned label strings (normalized — trimmed, whitespace-collapsed, lowercased).
- **`folder` field deprecated**: stop writing it on new feeds; keep reading for backward compat during transition.
- **Tag chips in sidebar**: between the "Feeds" heading and "All Feeds" entry — inline, subtle, auto-derived from all feeds' tags.
- **Tag filter mode**: clicking a tag chip filters the river to items from feeds that have that tag (OR semantics for multi-tag). Mutually exclusive with feed-scope selection. Clicking the active tag or "All Feeds" resets.
- **Feed edit modal**: new modal replacing the hover-reveal `✕` with a `…` action that opens a feed editor. Tags can be added/removed inline with autocomplete from existing tags across all feeds. Unsubscribe lives here too.
- **Tag autocomplete**: tag input in the add-feed flow and feed-edit modal surfaces all existing tags across feeds.
- **Sync**: tags carried in `feed-upsert` dirty entries and `RemoteFeed` with per-field timestamp conflict resolution using dedicated `tagsAt` timestamp (not `lastFetched`).

## Capabilities

### New Capabilities
- `feed-tags`: Tag assignment to feeds, with autocomplete from existing tags; tag removal.
- `tag-filter`: Sidebar tag chips with single and multi-tag (OR) river filtering; mutually exclusive with feed-scope selection.
- `feed-editor`: Modal UI for managing a feed's tags and unsubscribing.
- `sync-tags`: Sync of feed tags across devices via the existing sync protocol.

### Modified Capabilities
- `reader-ui`: Sidebar gains tag chips; feed rows change from hover-reveal `✕` to `…`; "All Feeds" becomes the reset for both scope and tag filter.

## Impact

- **src/db/types.ts**: Add `tags?: string[]` and `tagsAt?: number | null` to `Feed`; deprecate `folder`; bump `DB_VERSION` to 4.
- **src/db/feeds.ts**: CRUD for tags (part of upsertFeed).
- **src/components/Sidebar.tsx**: Add tag chip row between heading and feed list; change `✕` to `…`; wire tag click filter.
- **src/components/River.tsx**: `visibleItems()` memo gains tag-filter logic.
- **src/components/AddFeedModal.tsx**: Add tag input with autocomplete.
- **New: src/components/FeedEditor.tsx** (or inline in a modal): Tag management + unsubscribe.
- **src/sync/queue.ts**: `DirtyEntry.feed-upsert` gains `tags` / `tagsAt`.
- **src/sync/apply.ts**: `RemoteFeed` gains `tags` / `tags_at` with merge logic.
- **src/sync/merge.ts**: Pass tags through.
- **src/feeds/service.ts**: `SubscribeInput` gains optional `tags`.
- **src/state.tsx**: `AppState` gains `activeTags: Set<string>` state and `toggleTag()` / `clearTags()` methods.
- **src/styles.css**: New styles for tag chips, feed editor modal, `…` button.
