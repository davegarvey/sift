## Why

Sift already has a fully functional starring system (toggle star, persist to IndexedDB, sync), but there is no way to browse starred items. Users can star articles but can never find them again. This adds a simple, composable star filter that layers on any view — all, tag, or single feed.

## What Changes

- Add a sidebar toggle ("★") that filters the current view to starred-only items
- The toggle is orthogonal: it layers on top of `activeTags` and `riverScope` without clearing them
- Switching feeds/tags/views does not reset the starred toggle
- Internally: add `starredOnly: boolean` to `AppState`, wire into the river filter, add a sidebar button
- No changes to the existing starring data model, sync, or toggle UI
- No breaking changes

## Capabilities

### New Capabilities
- `starred-filter`: A toggle that narrows the current feed/tag view to show only starred items

### Modified Capabilities

None.

## Impact

- `src/state.tsx`: add `starredOnly` field to `AppState`, add `toggleStarredOnly` action, update `reloadItems` to call `listStarred()` when `starredOnly` is true and no feed/tag scope is active
- `src/components/Sidebar.tsx`: add ★ toggle button
- `src/components/River.tsx`: add `starred` filter pass to `visibleItems` memo
- `src/db/items.ts`: `listStarred()` already exists — may want to add feed- and tag-scoped variants for performance
