## Why

The current read/unread UX follows the email inbox model: unread counts in the sidebar, a filter toggle to hide read items, and an accent-colored dot on every unread item. This creates anxiety and noise for feed consumption. Feeds are streams, not inboxes — users dip in and out, and not every item needs to be "processed." Read state is useful as a personal reference ("have I seen this?") but numeric counts, filters, and persistent dots add friction without value.

## What Changes

- **BREAKING** Remove unread count badges from the sidebar (both total "All Feeds" count and per-feed counts)
- **BREAKING** Remove the Unread/All filter toggle from the sidebar
- **BREAKING** Remove the accent-colored unread dot indicator from river items
- Read/unread distinguished purely through title font-weight (unread = 600 bold, read = 400 normal, dimmer)
- Add a hover-reveal action toolbar on the right edge of river items (Gmail-style), starting with a mark-read toggle
- Star shown inline after the title text when active (no dedicated column)
- **BREAKING** Default river view shows all items (read + unread), not just unread
- **BREAKING** Empty state always says "No items yet." — no "You're all caught up." variant
- Remove the 24px indicator grid column from river items
- Remove `unreadOnly` parameter from `listItems()` / `listItemsByFeed()`
- Remove `readFilter` from AppState (keep in persisted settings type for backward compat)

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `reader-ui`: River default view changes from unread-only to all-items. Unread indicator changes from accent dot to title weight. Empty state loses "You're all caught up." Accent color usage restriction relaxed (no longer used for unread dot). Starring allowed inline in river (not just reading view and swipe). Progressive disclosure extended with hover toolbar on right edge.

## Impact

- `src/components/Sidebar.tsx` — remove filter toggle, counts, badge displays
- `src/components/River.tsx` — remove indicator column, add hover toolbar, simplify empty state
- `src/state.tsx` — remove readFilter from AppState, simplify reloadItems
- `src/db/items.ts` — remove unreadOnly parameter from listItems/listItemsByFeed
- `src/styles.css` — remove indicator/dot rules, add hover toolbar rules, update grid layout
- `src/db/types.ts` — readFilter stays in AppSettings type (no-op)
