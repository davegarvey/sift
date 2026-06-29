## 1. Foundation — per-feed fetching state

- [x] 1.1 Add `fetchingFeeds` signal (`Set<string>`) to `src/feeds/scheduler.ts`, tracking per-feed fetch lifecycle (add at entry of `refreshFeed`, remove in `finally`). Expose via `fetchingState` export.
- [x] 1.2 Wire `fetchingFeeds` through `AppContext` in `src/state.tsx` — add to the context interface, expose from `fetchingState`, so `Sidebar` and `River` can consume it.

## 2. Loading state components

- [x] 2.1 Add skeleton loading state to `src/components/River.tsx` — when `visibleItems().length === 0` and the current scope feed (or any feed, for "All"/"Unread" views) is in `fetchingFeeds`, render 5–6 skeleton placeholder cards instead of the empty state
- [x] 2.2 Add per-feed fetching spinner to `src/components/Sidebar.tsx` — in `FeedRow`, when the feed URL is in `fetchingFeeds`, show a small animated spinner next to the title
- [x] 2.3 Chain immediate item reload after subscribe in `src/components/AddFeedModal.tsx` — change `void refreshFeed(...)` to `void refreshFeed(...).then(() => ctx.reloadItems())`

## 3. CSS — animations and styles

- [x] 3.1 Add `@keyframes shimmer` animation and skeleton block/circle CSS classes to `src/styles.css`, using existing Catppuccin surface/overlay color variables
- [x] 3.2 Add sidebar fetching spinner styles to `src/styles.css`, reusing the existing `spin` keyframes
