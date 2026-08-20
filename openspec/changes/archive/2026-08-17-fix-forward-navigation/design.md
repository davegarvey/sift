## Context

The app uses the browser history API (`history.pushState`/`replaceState`) to manage navigation between the river (article list) and reading (single article) views. A `popstate` listener handles browser back/forward gestures.

Currently, `popstate` only handles the back direction: when the view is `'reading'`, it calls `closeReading()` to return to the river. The forward direction (returning from river to a previously viewed article) is unhandled — the URL changes but the UI stays on the river.

## Goals / Non-Goals

**Goals:**
- Browser forward gesture (after navigating back from an article) restores the reading view for that article
- Symmetric with the existing back behavior

**Non-Goals:**
- Changing how Escape/Back button work (they will continue to call `closeReading` with `replaceState` as before)
- History stack manipulation beyond what's needed

## Decisions

1. **Expand `onPop` in `App.tsx` instead of modifying `state.tsx`**
   The `closeReading` function's `replaceState('/')` call is fine — it replaces only the current history entry (which is `/` after a back navigation) and does not affect the forward stack. The fix is purely in the `popstate` handler to also match the forward case.
2. **Use `replace: true` when opening the item from forward navigation**
   `openItem(item, true)` uses `history.replaceState` instead of `pushState`, preventing duplicate history entries when navigating forward to an already-existing history entry.

## Risks / Trade-offs

- If the item has been deleted or evicted from the items list, forward navigation silently stays on the river. This is acceptable — the reading view cannot be restored without an item record.
- The `parseItemIdFromUrl` and `hashId` functions are already exported from `src/routing.ts` — no new imports or dependencies needed.
