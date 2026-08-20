## Why

When a user scrolls through the river, opens an article, then goes back, the focused item index is lost — the river either has no focus or the focus lands on a stale index that doesn't match the item they were reading. The user has to re-find their place.

## What Changes

- When the user opens an article from the river, record which item they opened.
- When they return to the river, find that item in the (possibly refreshed) item list and set `focusedIndex` to its new position.
- The existing `scrollIntoView` behavior on `focusedIndex` change will bring the item into view.
- No new scroll position tracking — we rely on the focused item's position in the list.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — this is a refinement to the existing reading/river interaction within the codebase, not a spec-level behavior change)

## Impact

- `src/state.tsx`: minor additions to state interface and `closeReading` logic
- `src/components/River.tsx`: track the return-to item on mount
