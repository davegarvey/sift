# Design: Sidebar Empty State

## Context

The sidebar (`src/components/Sidebar.tsx`) always renders the tag chips row (`all`, starred, tags) and an empty `.feed-list` div when `feeds().length === 0`. The collapsed rail and bottom actions are unaffected. `src/styles.css` has established muted-text patterns (e.g., `.heading` uses `--overlay`; feed rows use `--subtext`).

## Goals / Non-Goals

**Goals:**
- Reuse existing SolidJS `Show` conditional patterns already used in the sidebar (e.g., the feeds>0 guard on the refresh button at Sidebar.tsx:67).

**Non-Goals:**
- Changing the collapsed rail (its refresh button still lacks the feeds>0 guard — known inconsistency, out of scope).
- Adding an empty state for tag filters that match no feeds.
- Making the placeholder clickable/interactive.

## Decisions

**D1: Hide chips via `<Show when={ctx.feeds().length > 0}>` wrapper on `.tag-chips`.**
`feeds().length` is already the guard used for the refresh button — consistent and reactive. Alternative (CSS-only hide) rejected: leaves dead DOM and is less discoverable.

**D2: Placeholder as `<Show when={ctx.feeds().length > 0} fallback={<div class="feed-list-empty">No feeds, yet.</div>}>` around the `<For>` in `.feed-list`.**
`Show` with `fallback` avoids a separate ternary and keeps the feed-list container (which has `flex: 1`) so layout doesn't shift. Only the `feeds().length === 0` case gets the placeholder — not the tag-filter-empty case, per scope.

**D3: New `.sidebar .feed-list-empty` CSS class.**
Muted (`--subtext`), ~12px, `padding: 4px 16px` to align with feed rows. No new dependencies.

## Risks / Trade-offs

- Placeholder could be confused with an error state → Mitigated by muted styling matching existing secondary text, not alert colors.
- Chips row disappearing changes sidebar height slightly → Minor; section is flex-based and absorbs the shift.
