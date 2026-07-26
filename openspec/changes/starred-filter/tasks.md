## 1. State

- [x] 1.1 Add `starredOnly: boolean` (default `false`) to `AppState` in `src/state.tsx`
- [x] 1.2 Add `toggleStarFilter` action to `AppContext` that toggles `starredOnly` without touching `riverScope` or `activeTags`, and resets `focusedIndex` to 0
- [x] 1.3 Expose `toggleStarFilter` on the context value (not `toggleStarredOnly` — avoids confusion with per-item `toggleStar`)
- [x] 1.4 Verify `setRiverScope` and `toggleTag` do not clear `starredOnly`

## 2. Data loading

- [x] 2.1 Update `reloadItems` in `src/state.tsx`: when `starredOnly` is true and no feed/tag scope, call `listStarred(500)` instead of `listItems(500)`
- [x] 2.2 Ensure `listStarred` import is present

## 3. River filter

- [x] 3.1 In `River.tsx` `visibleItems` memo: when `starredOnly` is true, add an additional filter pass that keeps only `item.starred === true`
- [x] 3.2 In `River.tsx` `EmptyState`: when star filter is active and no items match, show "No starred items" with a button to disable the filter

## 4. Sidebar

- [x] 4.1 Add a ★ button to `Sidebar.tsx` in the same row as the "all" button
- [x] 4.2 Add a ★ button to the collapsed desktop sidebar rail
- [x] 4.3 Wire the button(s) to `ctx.toggleStarFilter`
- [x] 4.4 Style the button: tag-chip and collapsed-action.active styles (Mauve accent when active)
- [x] 4.5 Button has `title="Toggle starred filter"` and `aria-label`

## 5. Polish

- [x] 5.1 Run `npm run typecheck` — zero errors
- [x] 5.2 Run `npm run lint` — zero warnings
- [x] 5.3 Run `npm run build` — produces clean `dist/`
