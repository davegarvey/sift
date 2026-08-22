## 1. Data layer cleanup

- [x] 1.1 Remove `unreadOnly` parameter from `listItems()` and `listItemsByFeed()` in `src/db/items.ts`
- [x] 1.2 Remove `readFilter` from `AppState` type and initial value in `src/state.tsx`
- [x] 1.3 Simplify `reloadItems()` to call `listItems(500)` without options

## 2. Sidebar simplification

- [x] 2.1 Remove `setFilter`, `unreadCount`, `totalUnread`, `isUnread` functions from `src/components/Sidebar.tsx`
- [x] 2.2 Remove the filter toggle UI block (the Unread/All radiogroup)
- [x] 2.3 Remove the unread-count badge from "All Feeds" row
- [x] 2.4 Remove `unread` prop from `FeedRowProps` and all `FeedRow` invocations
- [x] 2.5 Remove the per-feed unread-count badge from `FeedRow`
- [x] 2.6 Restore `lastFeedUrl` setting on sidebar item click (already present — verify)

## 3. River item layout and read indicator

- [x] 3.1 Remove the 24px indicator grid column from `.river-item` (changed to `display: flex`)
- [x] 3.2 Remove the `.indicator` button (the dot/checkmark toggle) from river item JSX
- [x] 3.3 Remove the `.star` auto grid column from the river item JSX
- [x] 3.4 Add inline star `<span class="star-inline">` after title text, shown when `item.starred`
- [x] 3.5 Keep `toggleStar` import (used in swipe handler + toolbar; task adjusted)
- [x] 3.6 Simplify `EmptyState` — remove `isUnreadMode`, always show "No items yet."

## 4. Hover toolbar

- [x] 4.1 Add `.river-item .actions` container positioned absolute on the right edge (hidden by default, revealed on hover/focus)
- [x] 4.2 Add mark-read toggle icon (✓) to the toolbar
- [x] 4.3 Add star toggle icon (☆) to the toolbar
- [x] 4.4 Wire toolbar button clicks to `markRead()` and `toggleStar()` mutations
- [x] 4.5 Toolbar appears on both hover and focus (`.river-item:hover .actions, .river-item.focused .actions`)

## 5. CSS cleanup

- [x] 5.1 Remove `.sidebar .unread-count` rule
- [x] 5.2 Remove `.indicator`, `.tick`, `.checkmark` related rules
- [x] 5.3 Remove `.river-item .star` grid-column rule
- [x] 5.4 Remove `.has-touch-mark` rule
- [x] 5.5 Add `.river-item .actions` styles (absolute right, opacity 0→1 transition)
- [x] 5.6 Update `.river-item` grid from `grid-template-columns: 24px 1fr auto` to `display: flex`
- [x] 5.7 Title styling confirmed as the sole read/unread signal

## 6. Verify

- [x] 6.1 Run `npm run typecheck` — zero errors
- [x] 6.2 Run `npm run lint` — zero warnings
- [x] 6.3 Run `npm run build` — builds successfully
- [x] 6.4 Run `npm test` — all tests pass
- [ ] 6.5 Manual smoke test: sidebar shows no counts, river shows all items, hover toolbar appears, read/unread visible through title weight, empty state renders correctly
