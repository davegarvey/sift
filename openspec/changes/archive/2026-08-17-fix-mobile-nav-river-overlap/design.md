## Context

On mobile (≤768px), the TopBar is a fixed-position bar at the top of the viewport (`height: 40px`, or `44px` on touch devices via `any-pointer: coarse`). The river (feed item list) is a CSS grid cell that fills the remaining viewport height with `overflow-y: auto`. Currently the river has no `padding-top`, so its content scrolls behind the fixed TopBar — the first feed item is partially obscured.

The sidebar (which becomes a sliding drawer on mobile) handles this correctly: its `inset: 40px auto 0 0` (or `44px` on touch) positions it below the TopBar.

## Goals / Non-Goals

**Goals:**
- Prevent the fixed TopBar from obscuring river content on mobile
- Maintain correct behavior on touch devices where the TopBar is taller (44px + safe-area)
- Zero impact on desktop layout (TopBar is `display: none`)

**Non-Goals:**
- No structural or component changes to TopBar, Sidebar, or River
- No JavaScript changes
- No spec-level changes (CSS-only fix)

## Decisions

- **Approach: `padding-top` on `.river`** — The simplest CSS-only fix. The river's scrollable container gets `padding-top` equal to the TopBar height, shifting content below the fixed bar.
- **Why not `scroll-margin-top` or JS scroll offset?** — Padding on the scroll container is the standard CSS solution for fixed headers. No JS overhead, no scroll position glitches.
- **Why two values (40px / 44px)?** — The TopBar height differs on touch devices. The `any-pointer: coarse` query overrides the base mobile value, matching the existing pattern for sidebar `inset` and other touch optimizations.
- **No safe-area integration** — The TopBar already adds `padding-top: env(safe-area-inset-top)` on touch devices, so its content area is effectively 44px + safe-area. However, the sidebar `inset` already uses the same 44px value (not accounting for safe-area), so this is consistent. A future improvement could use a CSS custom property for the top offset, but that's out of scope.

## Risks / Trade-offs

- **Desktop touch (e.g., touchscreen iMac)** — The `any-pointer: coarse` block applies `.river { padding-top: 44px }` unconditionally, adding 44px of whitespace above the first feed item on desktop touch. This is minor and consistent with the existing pattern (`.topbar { height: 44px }` and other coarse-pointer overrides already apply unconditionally). Acceptable trade-off for simplicity.
- **Z-index stacking** — No change. TopBar remains at `z-index: 60`, river at default.
