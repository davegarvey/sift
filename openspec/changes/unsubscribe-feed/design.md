## Context

The app has a working subscribe flow (AddFeedModal → `upsertFeed` → `refreshFeed`) but no way to remove a subscription. The IndexedDB layer already has `deleteFeed(url)` and `deleteItemsByFeed(url)` — they just need wiring to the UI.

The sidebar currently has a bottom bar with a `+ Add feed` pill button. Moving it to the topbar places it alongside the existing refresh action and frees sidebar vertical space.

## Goals / Non-Goals

**Goals:**
- Feed rows in the sidebar show an unsubscribe affordance (hover-reveal on desktop, always-visible on mobile)
- Clicking triggers a confirmation modal before deletion
- Confirming deletes the feed and all its items, reloads state, resets river scope if needed
- Add-feed button moves from sidebar bottom to topbar as a `+` icon

**Non-Goals:**
- Bulk unsubscribe
- Feed-level settings beyond unsubscribe
- Undo after deletion
- Keyboard shortcut for unsubscribe (discoverable via context)

## Decisions

1. **Hover-reveal `×` button on feed rows, always-visible on touch devices**
   - Alternative considered: right-click context menu (extra complexity, not standard on web), swipe gesture (conflicts with river swipe), long-press (hidden affordance)
   - `@media (hover: hover)` CSS keeps it clean — no JS touch detection needed

2. **Browser `confirm()` vs custom modal for unsubscribe confirmation**
   - Custom modal: fits the app's visual language, consistent with other modals, prevents accidental submits
   - Added as a new `ModalKind` variant rather than a generic confirm dialog for type safety

3. **`unsubscribeFeed()` in `src/db/feeds.ts` rather than a separate service file**
   - Keeps data operations colocated with the existing feed DB functions
   - Simple orchestration: delete items first (foreign-key-like cleanup), then delete the feed

4. **`PlusIcon` extracted to a shared `Icons.tsx` module**
   - Avoids duplicating SVG markup; `RefreshIcon` already exists in Topbar and will be reused there

## Risks / Trade-offs

- **Accidental tap on mobile**: The `×` is always visible on touch devices. [Mitigation] The confirmation modal provides a safety net; the button is small (18×18px) which reduces accidental triggers.
- **State inconsistency if delete partially fails**: IndexedDB operations are not wrapped in a transaction across stores. [Mitigation] Items are deleted first — if the feed delete fails, orphaned items without a feed present no data corruption risk. A future improvement could wrap in a single transaction.
- **Removing the bottom bar reduces bottom-tap target on mobile**: [Mitigation] The add-feed is now in the topbar with other chrome, a more conventional placement.
