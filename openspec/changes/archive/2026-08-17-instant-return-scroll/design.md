## Context

Currently, when returning from reading view to the river, the user sees:

1. The reading view stays visible while `reloadItems()` reads from IndexedDB
2. The river mounts (or remounts via `<Show>` conditional rendering)
3. Two effect passes: first sets `focusedIndex`, second calls `scrollIntoView`
4. The scroll animates smoothly because `.river` has `scroll-behavior: smooth` in CSS and `scrollIntoView` uses `behavior: 'auto'` (which defers to CSS)

This creates a multi-frame sequence where the river appears, the item highlights, then the viewport slowly scrolls — the "catching up" sensation.

## Goals / Non-Goals

**Goals:**

- Eliminate the smooth scroll animation on return-to-river
- Eliminate the two-effect-pass rendering gap
- Eliminate the sequential-await delay before the river appears
- Preserve smooth scrolling for keyboard navigation and sidebar interactions (if currently applies)

**Non-Goals:**

- Changing the data loading strategy beyond reordering the view-switch
- Altering any other scroll behavior in the app
- Performance optimization of the `reloadItems` query itself

## Decisions

1. **Use `behavior: 'instant'` instead of `behavior: 'auto'` in `scrollIntoView`**: The CSS `scroll-behavior: smooth` on `.river` makes `behavior: 'auto'` animate. `behavior: 'instant'` overrides the CSS and snaps immediately. This limits the change to the JS call site rather than removing CSS that may affect other scrolls.

2. **Scroll in the same effect pass that resolves `returnToItemId`**: Instead of setting `focusedIndex` and returning (requiring a second effect run to scroll), query the DOM for the target element and call `scrollIntoView` in the same pass. The scroll happens immediately after mount; the `focused` class applies on the next render.

3. **Move `setState({ view: 'river' })` before `await reloadItems()`**: Switching the view immediately shows the river with existing items (which are already loaded from the prior render cycle). The `reloadItems` runs in the background, updating items after the river is already visible and scrolled. The browser preserves scroll position across the item update.

## Risks / Trade-offs

- [Stale items on mount] → The river mounts with the item list from before the user opened the reading view. If items were modified by sync in the background while reading, the initial render won't reflect them. The reload completes shortly after and updates the list. Acceptable trade-off for instant feel.
- [Item filtered out after reload] → If the item was marked as read (and read items are hidden) during the reading session, the reload might remove it from the visible list. The existing guard at River.tsx:54 (`if (idx < 0 || idx >= items.length)`) handles this gracefully.
- [Two scrolls on mount] → The initial effect pass scrolls to the item. If `reloadItems` completes before the next effect run, no re-scroll happens because `returnToItemId` is already cleared.
