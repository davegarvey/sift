## Why

The sidebar currently has "Unread" and "All" as separate text entries that conflate two independent axes: scope (which feed) and filter (read status). Clicking a feed deselects the filter pills, making the active filter invisible. The user cannot tell whether they're viewing unread-only or all items for a single feed. This coupling creates persistent confusion about what state the river is in.

## What Changes

- Replace the "Unread" / "All" text entries in the sidebar with a compact icon-toggle component (Lucide `CircleDot` / `Inbox`) that controls only the read filter — never scope.
- Add an "All Feeds" scope entry as the first row in the sidebar's feed list, with a total unread count. Clicking it sets scope to all feeds — never the filter.
- Decouple filter from scope into two fully independent controls. The toggle always shows the active filter regardless of which feed is selected. Scope rows always show the active scope regardless of which filter is active.
- Wire `reloadItems()` into the toggle handler so changing the filter re-fetches from IndexedDB with the new filter.

## Capabilities

### New Capabilities

(none — this is a refinement of existing reader UI)

### Modified Capabilities

- `reader-ui`: The sidebar filter UX changes. The "Unread" / "All" entries are replaced with an icon toggle and an "All Feeds" scope row. The 2x2 matrix of scope × filter becomes explicit.

## Impact

- **Sidebar.tsx**: Remove the Unread/All section; add FilterToggle component; add "All Feeds" scope row.
- **River.tsx**: No changes to core filtering — `reloadItems()` still drives item data; the toggle simply calls it.
- **state.tsx**: No interface changes needed.
- **CSS**: New styles for the filter toggle and All Feeds row.
- **Dependencies**: Add `lucide-solid`.
