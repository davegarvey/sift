## Why

After subscribing to a new feed, the river shows "No items yet" while the first fetch is in flight. The user sees an empty void for 5–30+ seconds with no indication that content is loading, then items appear all at once. This is confusing and makes the app feel broken on first use.

## What Changes

- **Skeleton loading state in the river**: When a feed (or the "All" view) has zero items because the initial fetch is still in progress, show 5–6 shimmer skeleton cards matching the river-item layout instead of the "No items yet" empty state
- **Per-feed fetching indicator in the sidebar**: While a feed is being fetched, display a small spinning indicator next to its title in the sidebar
- **Immediate item appearance after fetch**: After subscribing, items appear in the river as soon as the fetch completes, without waiting for the 30-second polling interval

No breaking changes. All existing empty states ("Welcome to Sift", "You're all caught up", "No items yet") remain unchanged when no fetch is in progress.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reader-ui`: When the river has no items because a feed is being fetched for the first time (or after the user triggered a refresh), show skeleton/shimmer placeholder cards instead of the "No items yet" empty state. The sidebar shows a per-feed spinner while a feed fetch is in flight. After a subscribe's fetch resolves, items appear immediately without waiting for the periodic polling interval.

## Impact

- `src/feeds/scheduler.ts` — add a per-feed fetching state signal so the UI can react to individual feed fetch progress
- `src/components/River.tsx` — add skeleton placeholder rendering when the empty state is due to an in-flight fetch
- `src/components/Sidebar.tsx` — add spinner indicator to feed rows that are currently being fetched
- `src/components/AddFeedModal.tsx` — chain `reloadItems()` after the subscribe fetch resolves
- `src/state.tsx` — expose the per-feed fetching signal through the app context
- `src/styles.css` — add `@keyframes shimmer`, skeleton block/circle classes, and sidebar spinner animation
- No new dependencies
