## Why

Users have no way to remove a feed they no longer want. The database primitives exist (`deleteFeed`, `deleteItemsByFeed`) but are inaccessible from the UI. Adding unsubscribe completes the feed lifecycle. Moving the add-feed button to the topbar groups feed actions together and reclaims sidebar space.

## What Changes

- **Unsubscribe from feed**: Each feed row in the sidebar gains a `×` button to unsubscribe. On hover-supporting devices the button is hover-revealed; on touch devices it is always visible. Clicking opens a confirmation modal ("Unsubscribe from [title]? This will remove the feed and all its items."). Confirming deletes the feed and all its items from IndexedDB, then reloads state.
- **Add-feed button moves to topbar**: The `+ Add feed` button (currently a pill at the bottom of the sidebar) moves to the topbar as a `+` icon button alongside the existing refresh and settings buttons. The sidebar bottom bar is removed.
- No breaking changes.

## Capabilities

### New Capabilities
- `unsubscribe-feed`: Unsubscribing from a feed via the sidebar, including hover/touch interaction, confirmation, and data deletion

### Modified Capabilities
(none — the add-feed UI relocation is an implementation detail, not a requirement change)

## Impact

- `src/components/Sidebar.tsx` — Add `×` button to `FeedRow`; remove bottom add-feed bar
- `src/components/Topbar.tsx` — Add `+` button that opens AddFeedModal
- `src/components/Icons.tsx` (new) — Shared `PlusIcon` component
- `src/state.tsx` — Add `confirm-unsubscribe` to `ModalKind`
- `src/components/ConfirmUnsubscribeModal.tsx` (new) — Confirmation dialog
- `src/App.tsx` — Wire the new modal
- `src/db/feeds.ts` — Add `unsubscribeFeed()` orchestration function
- `src/styles.css` — Add styles for delete button, icon button, hover/touch rules
