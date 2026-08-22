## Context

The sidebar currently renders "Unread" and "All" as two `<div class="all">` entries in a `.section` at the top. Both call `selectView(null, filter)` which simultaneously sets `riverScope = null` (scope = all feeds) and `readFilter = filter`. Clicking a feed calls `selectFeed(feedUrl)` which sets `riverScope = feedUrl` but does not touch `readFilter`.

The active-state computation is:
```ts
const unreadActive = () => ctx.state.riverScope === null && ctx.state.readFilter === 'unread';
const allActive = () => ctx.state.riverScope === null && ctx.state.readFilter === 'all';
```

Because both pills require `riverScope === null`, clicking any feed deselects them. The user loses visibility of the active filter. Additionally, `selectView` does not call `reloadItems()`, so the new filter takes effect only on the next 30-second poll or reading-view exit.

## Goals / Non-Goals

**Goals:**
- Decouple filter (`readFilter`) from scope (`riverScope`) into two fully independent UI controls
- The filter toggle always shows the active state regardless of which feed is selected
- Adding "All Feeds" as a scope entry so the user can always return to all-feeds view
- Wire `reloadItems()` to the filter toggle so changing filters immediately re-fetches
- The sidebar remains scope-only; the filter toggle lives at the top of the sidebar

**Non-Goals:**
- Not adding a filter toggle in the river or topbar
- Not changing the Reading view, command palette, or any other component
- Not changing the `readFilter` or `riverScope` data model in `state.tsx`
- Not changing how items are filtered or stored in IndexedDB

## Decisions

### D1: Filter toggle stays in the sidebar, not the river or topbar

The toggle replaces the current "Unread" / "All" entries in the sidebar's first section. It uses Lucide icons (`CircleDot` / `Inbox`) as a two-button segmented control. The label text is shown on desktop and hidden on mobile to keep the sidebar narrow.

- **Why**: Keeps all navigation-related chrome in one place (the sidebar). The user can see scope and filter in the same visual panel. Aligns with the sidebars-in-readers convention while replacing the confusing old pills.
- **Alternatives considered**: River header (adds a second navigation zone), TopBar (too cramped with existing buttons). Both would split navigation across two areas.

### D2: "All Feeds" row is the first entry in the feeds list

A synthetic scope row styled like a feed row (`.feed` CSS class) that sits before folders and unclassified feeds. Shows "All Feeds" with the total unread count.

- **Why**: Provides an explicit way to return to all-feeds scope that sits alongside the feed list. Pattern matches NetNewsWire's "All Unread" smart feed and Reeder's "All Items" at the top of the feed list.
- **Alternatives considered**: Clicking the toggle resetting scope (conflates filter and scope again — the exact problem we're fixing), scope label in river header (splits navigation).

### D3: Toggle click handler calls `reloadItems()`

The current `selectView` sets state but doesn't re-fetch from DB. The new toggle handler will: `setState` + `saveSettingsPatch` + `await ctx.reloadItems()`.

- **Why**: The items in memory were fetched with the old `readFilter` value. Without a re-fetch, the river shows stale data until the next poll. This is the bug report from the original observations.

### D4: Lucide icons for the toggle

Using `lucide-solid` for `CircleDot` (unread) and `Inbox` (all). The existing codebase has hand-written SVG icons in `Icons.tsx`, but adding a small UI icon library is justified for a single clean dependency.

- **Why**: Clean, consistent, tree-shakeable icons. The user explicitly requested Lucide.
- **Alternatives**: Inlining SVG paths (works but no longer uses the library the user asked for).

### D5: Toggle uses two `<button>` elements in a row, not a single checkbox or `<select>`

A two-button segmented control where the active button gets `.active` styling (accent background). Clicking the already-active button is a no-op.

- **Why**: Matches the pattern of a "toggle" — two mutually exclusive options. Accessible (role="radio" group pattern). Clear active state via CSS class.
- **Alternatives**: Single checkbox (binary on/off doesn't communicate All vs Unread), radio group (more verbose HTML for no benefit), select dropdown (hidden affordance).

## Risks / Trade-offs

- **[R1] Extra dependency weight**: `lucide-solid` adds ~2KB gzipped for the two icon components we import. Acceptable for the requested icon library.
- **[R2] Sidebar gets denser**: Adding "All Feeds" plus the toggle at the top increases sidebar height slightly. The "All Feeds" row is similar height to a feed row; the toggle is compact. Overall impact is minor.
- **[R3] Toggle + "All Feeds" can feel redundant**: When "All Feeds" is selected and the toggle is on "Unread", the user sees "All Feeds" + unread dot — meaning "show me all feeds, unread only". This is the correct 2x2. It may take a moment for new users to internalize that these are independent controls, but that's the explicit design we're choosing.

## Migration Plan

1. Install `lucide-solid`
2. Modify `Sidebar.tsx`: remove Unread/All section, add FilterToggle component, add "All Feeds" scope row
3. Add CSS for the toggle (segmented control) and "All Feeds" row
4. Run `npm run typecheck` and `npm run lint` — zero errors
5. Run `npm run dev` and verify:
   - Toggle switches between unread/all and re-fetches immediately
   - "All Feeds" returns to all-feeds scope
   - Filter stays active when selecting a feed
   - Settings persist across reload
6. No rollback risk — this is a pure UI refactor of existing sidebar code

## Open Questions

None resolved — all decisions above are committed.
