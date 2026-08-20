## Context

Sift already has a complete starring system:
- `Item.starred: boolean` in the data model
- `listStarred(limit)` query using the `by-starred` IndexedDB index
- Star toggle in `River.tsx` and `ReadingView.tsx`
- `s` keyboard shortcut
- Sync support via `starred`/`starredAt` flag fields
- `toggleStar` action wired through to sync

What's missing: a way to *navigate to* starred items. The proposal adds a ★ toggle in the sidebar that layers on whichever view the user is currently in (all, tag, or single feed).

## Goals / Non-Goals

**Goals:**
- Add a `starredOnly: boolean` toggle to app state that is orthogonal to `riverScope` and `activeTags`
- Add a ★ button to the sidebar that toggles the filter
- Wire the river view to filter by `item.starred` when `starredOnly` is true
- When `starredOnly` + no feed/tag scope, use `listStarred()` directly for efficient IndexedDB access
- Persist the toggle state across view switches

**Non-Goals:**
- Changing the star data model or existing toggle UI
- Adding per-feed "starred" queries (only all-starred and filter-in-memory)
- Star count badges or analytics

## Decisions

### Orthogonal toggle vs special view
**Decision**: Use a separate `starredOnly` boolean in AppState, rather than a magic `riverScope` sentinel or synthetic tag.

**Rationale**: A sentinel like `'__starred__'` for `riverScope` would be mutually exclusive with feed views, losing composability. A synthetic tag would muddy the feed-level vs item-level distinction and require special-casing `allTags()`. A simple boolean is the smallest change — it layers on any view, is never cleared by `setRiverScope`/`toggleTag`, and is easy to reason about.

### Sidebar placement
**Decision**: The ★ button sits in the same row as "all", above tag chips.

```
FEEDS
  [all]  [★]
  [tech]  [news]
  ─────────────────
  Feed A  Feed B
```

**Rationale**: "all" and ★ are both view-wide filters that complement each other. Tags come after. This makes the grouping clear without needing section headers.

### Active visual
**Decision**: When active, the ★ button uses the Catppuccin Mauve accent (same as active tag chips). The star icon fills solid.

### No backfill
**Decision**: No DB migration needed — `starred` already exists on all items. The filter is purely read-side.

### Naming
**Decision**: `toggleStarFilter` for the action (not `toggleStarredOnly`). `starredOnly` for the state field. This avoids confusion with `toggleStar` (per-item star toggle).

**Rationale**: "star filter" vs "star" distinguishes global filter from per-item action at a glance in code review.

### No dedicated keyboard shortcut
**Decision**: No new keyboard shortcut for the filter toggle. The `s` key is already "Toggle star" (per-item). Adding a second binding on `s` in a different context would be fragile. Users toggle the filter via the sidebar button (mouse/touch).

**Rationale**: The shortcut `s` for per-item star toggle is well-established. A second shortcut like `t` for filter toggle adds surface area without strong user demand. Can be added later if needed.

### Collapsed sidebar rail includes ★
**Decision**: The ★ button appears in both the expanded sidebar and the collapsed desktop rail.

### Empty state awareness
**Decision**: When `starredOnly` is active and no items match, `EmptyState` shows "No starred items" instead of the default message, with a button to disable the filter.

## Risks / Trade-offs

- **Performance on large starred sets**: When `starredOnly` is on with a feed or tag scope, we filter items in memory (the items are already loaded from the DB). For most users this is fine — the item limit is 500. If it becomes a problem we can add an IndexedDB query later.
- **State persistence**: The toggle resets on page reload (like `activeTags`/`riverScope`). Not persisted to settings. This is consistent with existing behavior.
- **Return-to-item after unstar**: If a user opens a starred item, unstars it (presses `s`), then goes back (Esc), the river re-filters with `starredOnly` still active and the item is gone. The user lands on an empty river. Mitigation: the "no starred items" empty state includes a link to disable the filter, and the river stays on the same view without jarring transitions.
- **toggleStar triggers reloadItems**: Every per-item star toggle re-reads the full item list from DB. Under `starredOnly`, this swaps the entire array. Mitigation: this is pre-existing behavior; the empty-state handling makes the worst case (last item unstarred → empty river) navigable.
