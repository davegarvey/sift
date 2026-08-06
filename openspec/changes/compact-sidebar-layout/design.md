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
- Preserve first-run discoverability via the river empty-state "Add your first feed" CTA (the sole add-feed affordance on a fresh install).
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
`ctx.feeds().length === 0` (not `visibleFeeds()`), since tag filtering can empty the list while feeds exist. When empty: the add-feed icon stays visible as a persistent affordance, and the refresh icon hides until at least one feed is subscribed (refresh of nothing is meaningless). No add-feed CTA is rendered in the sidebar feed list — the river empty state ("Welcome to Sift" / "Add your first feed") is the primary CTA on a fresh install. When feeds exist but the active filter matches none, both icons stay visible.
*Alternatives:* Option A (always icon-only) hurt fresh-install discoverability. Option C (full-width labeled Add until first feed) superseded by the river empty-state CTA — same goal, one pattern instead of two — rejected. A sidebar empty-state CTA was implemented first, then removed as a duplicate of the river CTA (spec deviation). The heading refresh icon hiding until the first feed exists is a follow-up refinement (spec deviation).

**D4: CTA styling follows the empty state, not the other way around.**
The river's "Add your first feed" CTA reads as a quiet button — `--surface` background, muted accent border, accent text, hover to accent tint — visually distinct from plain links while fitting the app's quiet aesthetic. The heading icons are quiet utility controls.

## Risks / Trade-offs

- [Icon-only CTAs are less discoverable for returning users] → Mitigated: tooltips, established collapsed-rail precedent, and the river empty-state CTA covers the worst case (fresh install).
- [Fixed tag-chip zone grows tall with many tags on narrow screens, shrinking the feed list] → Accepted trade-off, it is the requested behavior; chips are small and wrap.
- [Nested scroll containers can double scrollbars] → `.feed-list` is the only inner scroller; the section no longer scrolls, so no nesting.
- [Accessibility regression from label-less buttons] → `aria-label` + `title` on every heading CTA; keyboard focus styling carried over from collapse-button pattern.

## Migration Plan

Single PR. No data migration, no server impact. Rollback is reverting the PR — layout is purely client-side CSS/JSX.

## Open Questions

- Whether the filtered-empty case should eventually show a subtle "no matching feeds" hint (explicitly out of scope here).
