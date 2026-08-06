## Context

The sidebar (`src/components/Sidebar.tsx`) is a column flex layout with a fixed wordmark header and a pinned bottom action group. In between, `.sidebar .section` (`styles.css:464-468`) is `flex: 1; overflow-y: auto`, which scrolls the Feeds heading, the tag chips, and the feed list as one block. Above the section sit two full-width action rows — Add feed (`Sidebar.tsx:56-60`) and Refresh (`Sidebar.tsx:62-71`) — that consume roughly 60px of vertical space.

Two symptoms follow from this structure:

1. Vertical space is wasted on full-width labeled rows when icon-only CTAs would suffice — the collapsed rail (`Sidebar.tsx:159-172`) already proves the icon+tooltip pattern works in this app.
2. Scrolling down a long feed list scrolls the tag chips out of view, so switching filters requires scrolling back to the top.

Constraint: the sidebar is a single shared component for desktop (fixed column) and mobile (full-screen drawer, `styles.css:356-369`). Any structural change must work in both.

## Goals / Non-Goals

**Goals:**
- Reclaim the two full-width CTA rows by moving Add feed and Refresh into the Feeds heading row as compact icon buttons.
- Restrict scrolling to the feed list; keep the Feeds heading, CTA icons, and tag chips fixed.
- Preserve first-run discoverability with a prominent "Add your first feed" empty-state CTA when zero feeds exist.
- Keep existing behavior: refresh spinner + disabled state, aria-labels/tooltips, touch-friendly sizing.

**Non-Goals:**
- No redesign of the collapsed rail, bottom action group, or wordmark header.
- No empty-state hint for "no feeds match the active tag filter" — out of scope; only the zero-feed fresh-install case gets the prominent CTA.
- No changes to data model, storage, or server.

## Decisions

**D1: Three-zone layout — fixed header, fixed heading+chips, single scrolling feed list.**
`.sidebar .section` stops being the scroll container. The heading row and tag chips become static siblings; a new `.feed-list` child owns `flex: 1; overflow-y: auto`. The scrollbar stays at the right edge because the section still spans the sidebar width.
*Alternatives:* Keep the whole section scrolling (status quo — the problem being fixed). Scroll only the section while rest of sidebar scrolls (redundant nested scrollers — rejected).

**D2: Icon-only CTAs in the heading row.**
Two 28px icon buttons (Plus, RefreshIcon) in the heading row, styled like the existing collapse button (`styles.css:419-433`): subtext color, hover → surface background/text. Each carries `title` + `aria-label`. Refresh reuses `RefreshIcon spinning` (spinner color overrides already exist at `styles.css:454`).
*Alternatives:* Keep text labels (defeats the purpose). Show labels on wide screens only (sidebar width is fixed; adds conditional markup for little gain — rejected).

**D3: Empty state = zero subscribed feeds.**
`ctx.feeds().length === 0` (not `visibleFeeds()`), since tag filtering can empty the list while feeds exist. When empty: hide both heading icons and render a prominent "Add your first feed" button inside the feed-list area (only add-feed affordance, per user decision). When feeds exist but the active filter matches none, the empty-state CTA must NOT appear — the icons stay visible.
*Alternatives:* Option A (always icon-only) hurt fresh-install discoverability. Option C (full-width labeled Add until first feed) is superseded by the empty-state CTA — same goal, one pattern instead of two — rejected.

**D4: CTA styling follows the empty state, not the other way around.**
The "Add your first feed" button is visually distinct — accent-tinted or bordered treatment using existing tokens (`--accent`, `--accent-dim`, `--surface`) — so a first-run user sees one clear call to action. The heading icons are quiet utility controls.

## Risks / Trade-offs

- [Icon-only CTAs are less discoverable for returning users] → Mitigated: tooltips, established collapsed-rail precedent, and the empty-state CTA covers the worst case (fresh install).
- [Fixed tag-chip zone grows tall with many tags on narrow screens, shrinking the feed list] → Accepted trade-off, it is the requested behavior; chips are small and wrap.
- [Nested scroll containers can double scrollbars] → `.feed-list` is the only inner scroller; the section no longer scrolls, so no nesting.
- [Accessibility regression from label-less buttons] → `aria-label` + `title` on every heading CTA; keyboard focus styling carried over from collapse-button pattern.

## Migration Plan

Single PR. No data migration, no server impact. Rollback is reverting the PR — layout is purely client-side CSS/JSX.

## Open Questions

- Whether the filtered-empty case should eventually show a subtle "no matching feeds" hint (explicitly out of scope here).
