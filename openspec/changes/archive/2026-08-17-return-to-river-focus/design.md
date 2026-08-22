## Context

The river view (`River.tsx`) is mounted/unmounted as the user switches between river and reading views (`<Show when={!reading()}>` in `App.tsx`). When the user returns from reading, `focusedIndex` in state retains its old value, which may point to a different item (if the list changed via `reloadItems`) or be `-1` (from mouse leave). The user has to manually scroll to find where they were.

## Goals / Non-Goals

**Goals:**
- When user returns to the river after reading an article, `focusedIndex` points to the item they just read
- The existing `scrollIntoView-on-focusChange` behavior scrolls that item into view

**Non-Goals:**
- No exact pixel-level scroll position restoration
- No persistence across app restarts

## Decisions

**Decision: Save item ID, not scroll position.**  
Alternatives considered:
- Saving scrollTop pixel position — fragile if items reload and DOM height changes. Also conflicts with `onFocusChange` which calls `scrollIntoView`.
- Saving index (position in list) — stale if items are added/removed between open and return.
- **Chosen: Save `item.id` and look up the index after items reload.** This is robust across list mutations and avoids any coordination between scroll and focus effects.

**Decision: Two new state fields, `returnToItemId` — saved when opening an item, cleared after restoration.**  
The River component on mount watches for `returnToItemId`, finds the matching item, sets `focusedIndex`, and clears the field. The existing `onFocusChange` effect does the scrolling automatically.

## Risks / Trade-offs

- **Item no longer exists** → If the item was deleted between open and return, `focusedIndex` stays at its previous value. This is acceptable — the user can scroll freely.
- **List order changed** → If new items were inserted above, the viewed item may appear at a different position. The ID lookup handles this correctly; the user will see the item in its new context.
