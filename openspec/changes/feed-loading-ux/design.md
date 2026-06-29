## Context

When a user subscribes to a new feed, `AddFeedModal.subscribe()` calls `refreshFeed()` in a fire-and-forget pattern. The fetch resolves after a network round-trip plus XML parsing (typically 2–10s for a well-formed feed, longer for large feeds). During this window the river shows "No items yet" because IndexedDB is still empty for that feed. Even after the fetch completes and items are stored, the river doesn't update until the next 30-second polling interval.

The scheduler already tracks a global `inFlight` counter (used by the TopBar refresh spinner) but doesn't expose per-feed state. There is no loading/feedback mechanism for the subscribe flow beyond the global refresh spinner.

## Goals / Non-Goals

**Goals:**
- When a feed is being fetched and has no items in the river, show shimmer skeleton placeholders instead of the "No items yet" empty state
- Show a per-feed fetching indicator in the sidebar while that feed's fetch is in flight
- After subscribing, items appear in the river as soon as the fetch completes, without waiting for the periodic poll
- Keep the implementation self-contained — no new dependencies, no major architectural changes

**Non-Goals:**
- Changing the existing poll-based refresh cycle for background stale-feed refreshes (the 30s poll is fine there; only the subscribe-triggered path gets immediate reload)
- Granular progress reporting ("3 of 47 items loaded")
- Pull-to-refresh or gesture-based loading states
- Skeleton states for the reading view or other panels

## Decisions

### D1: Per-feed fetching state via `Set<string>` signal

Add a `fetchingFeeds` signal to `scheduler.ts`:

```ts
const [fetchingFeeds, setFetchingFeeds] = createSignal<Set<string>>(new Set());
```

At the start of `refreshFeed()`, the feed's URL is added to the set. The `finally` block removes it. Exposed via the existing `fetchingState` export.

**Alternatives considered:**
- `Record<string, boolean>` — functionally equivalent but `Set.has()` is slightly more idiomatic for membership checks
- Extending the `inFlight` counter to track URLs — would change the existing contract and require migration of the TopBar spinner

**Rationale:** Immutable set updates (`new Set(prev).add(url)`) trigger SolidJS reactivity correctly. The set API is clean for the membership checks the UI needs.

### D2: Immediate item reload chained from subscribe

In `AddFeedModal.subscribe()`, change:

```ts
void refreshFeed({...});
```

to:

```ts
void refreshFeed({...}).then(() => ctx.reloadItems());
```

**Alternatives considered:**
- Have `refreshFeed()` accept a callback — adds coupling between scheduler and UI state
- Have the 30s poll run on a shorter interval — wasteful for background operation
- Dispatch a custom DOM event — unnecessarily indirect

**Rationale:** Simplest change that achieves the goal. Fire-and-forget is preserved (errors don't propagate), and the modal has already closed. Adding `.then(() => ctx.reloadItems())` ties the item reload to fetch completion without modifying the scheduler's contract.

### D3: Skeleton placeholder cards in the river

Show 5–6 shimmer placeholder cards when both conditions hold:
1. `visibleItems().length === 0` (the river would show an empty state)
2. The current scope (or any feed for "All" view) is in `fetchingFeeds`

The skeleton cards are styled to match river-item layout:
- A small circle block for the read/unread indicator
- A narrow bar for the meta line (source + timestamp)
- A slightly wider bar for the title
- A longer, thinner bar for the excerpt

**Visibility rules:**
- Specific feed scope: skeleton shown when `fetchingFeeds().has(feedUrl) && items.length === 0`
- "All" scope: skeleton shown when `fetchingFeeds().size > 0 && items.length === 0`
- "Unread" scope: same as "All" (treated identically for skeleton purposes)
- If items are already in the river (even if a fetch is also in progress), no skeleton

**Rationale:** Skeletons provide visual continuity — the layout is already established, and items appear to fill in naturally. This is the standard pattern for content-loading states (Medium, GitHub, Slack, etc.).

### D4: Sidebar spinner indicator

When a feed's URL is in `fetchingFeeds`, show a small inline spinner next to the feed title. The existing `SpinnerIcon` SVG component in `TopBar.tsx` is reused.

**Visual behavior:**
- Spinner replaces or appears before the unread count
- Uses the existing `spin` animation from `styles.css`
- Disappears when the feed is no longer in `fetchingFeeds`

**Rationale:** The sidebar is where the user sees the feed listed immediately after subscribing. The spinner confirms "this feed is being fetched" without requiring the user to navigate to that feed's view.

### D5: CSS shimmer animation

```css
@keyframes shimmer {
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
```

Skeleton blocks use a `background` with a linear gradient and the shimmer animation:
- Base color: Catppuccin `--surface0` (matches the item background)
- Shimmer sweep: `--overlay0` (slightly lighter/darker sweep moving left-to-right)
- `border-radius`: matches existing river-item corners

**Duration:** 1.5s, `linear`, `infinite`.

## Risks / Trade-offs

- **Flash of skeleton → immediate items**: If the fetch completes very quickly (sub-second), the skeleton might flash briefly before items appear. This is an inherent trade-off of any loading state. Mitigation: the skeleton is visually subtle (a gentle shimmer, not a jarring element), and a brief flash is preferable to a confusing empty state.
- **Skeleton shown but no fetch in progress for that feed**: Race condition if the user navigates to a feed just as its fetch finishes. Mitigation: the check `items.length === 0` ensures the skeleton only appears when there's truly nothing to show; if items are already stored, the existing river renders immediately.
- **Sidebar spinner flickering on rapid refreshes**: Possible if multiple sequential fetches overlap. Mitigation: the spinner is tied to `fetchingFeeds`, which tracks per-fetch lifetime; rapid start/stop is naturally smoothed by the fetch retry/error handling in the scheduler.
