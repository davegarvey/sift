## Why

The river currently hides read items entirely — once marked read, an item disappears from the list. Users have no way to re-read items they've seen before without searching. Other RSS readers (NetNewsWire, Reeder, Feedly) offer an "All Items" view alongside "Unread" to support browsing history.

## What Changes

- Add "Unread" and "All" as virtual entries at the top of the sidebar, controlling whether the river shows unread-only or all items
- Feed entries in the sidebar respect the current read filter (sticky — clicking a feed doesn't reset it)
- The last selected sidebar entry (Unread / All / specific feed) is persisted in IndexedDB and restored on next boot
- Default for new users: "Unread" (preserving current behavior)
- Raise the item fetch limit from 200 to 500 to handle the larger "All" result set
- Empty state ("You're all caught up") appears only in "Unread" mode when no unread items exist
- The existing per-item read/unread toggle, swipe-right, and scroll-past mark-read continue to work in both modes (in "All" mode, marked-read items stay visible and update their visual styling)

## Capabilities

### New Capabilities

None — this is a modification of the existing reader UI.

### Modified Capabilities

- `reader-ui`: Add "Unread" and "All" sidebar entries that control read filtering. The default view is still unread-only, but "All" mode shows every item with read/unread visual distinction. The last selected sidebar entry is persisted across sessions.

## Impact

- `src/state.tsx` — add `readFilter` to AppState, branch `reloadItems()`, persist sidebar selection on nav, restore on boot
- `src/db/types.ts` — add `lastFeedUrl` and `readFilter` to `AppSettings`
- `src/db/items.ts` — add `listAcrossFeeds(limit, opts?)` that supports both unread-only and all-items retrieval; increase default limit to 500
- `src/components/Sidebar.tsx` — add "Unread" entry, rewire "All" entry (now shows all items), persist selection on click
- `src/components/River.tsx` — conditional empty state; ensure scroll-past observer works correctly
- No new dependencies
