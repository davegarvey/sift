## Context

When a user subscribes to a new feed, `AddFeedModal.subscribe()` calls `refreshFeed()` in a fire-and-forget pattern. The fetch resolves after a network round-trip plus XML parsing (typically 2–10s for a well-formed feed, longer for large feeds). During this window the river shows "No items yet" because IndexedDB is still empty for that feed. Even after the fetch completes and items are stored, the river doesn't update until the next 30-second polling interval.

The scheduler already tracks a global `inFlight` counter (used by the TopBar refresh spinner) but doesn't expose per-feed state. There is no loading/feedback mechanism for the subscribe flow beyond the global refresh spinner.

## Goals / Non-Goals

**Goals:**
- When a feed is being fetched and has no items in the river, show a delayed, fading "Loading…" message instead of the "No items yet" empty state
- Show a per-feed fetching indicator in the sidebar while that feed's fetch is in flight
- After subscribing, items appear in the river as soon as the fetch completes, without waiting for the periodic poll
- Keep the implementation self-contained — no new dependencies, no major architectural changes

**Non-Goals:**
- Changing the existing poll-based refresh cycle for background stale-feed refreshes (the 30s poll is fine there; only the subscribe-triggered path gets immediate reload)
- Granular progress reporting ("3 of 47 items loaded")
- Pull-to-refresh or gesture-based loading states
- Skeleton cards or loading states for the reading view or other panels

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

### D3: Delayed "Loading…" message in the river

Show a simple centered message when both conditions hold:
1. `visibleItems().length === 0` (the river would show an empty state)
2. The current scope (or any feed for "All" view) is in `fetchingFeeds`, OR the app has not finished boot hydration

The message is a single text node (`Loading…`) styled with `--subtext`. It mounts immediately but its `visible` class is set by a 500ms `setTimeout` inside the component (cleared via `onCleanup` on unmount), so loads under ~500ms never show it. A 0.25s ease-in opacity transition fades it in; `prefers-reduced-motion` disables the transition.

**Visibility rules:**
- Specific feed scope: message shown when `fetchingFeeds().has(feedUrl) && items.length === 0`
- "All" scope: message shown when `fetchingFeeds().size > 0 && items.length === 0`
- "Unread" scope: same as "All"
- Boot hydration: message shown whenever `!hydrated() && items.length === 0`
- If items are already in the river (even if a fetch is also in progress), no message

**Rationale:** Hydration is typically sub-second, and a placeholder that flashes for <500ms is noise. The delay means fast loads show content directly with zero placeholder; only genuinely slow loads (first-feed fetch, cold boot) get a calm message. A static skeleton was rejected: `background-position` shimmer repaints each frame and reads as jittery, and mock cards on a fast load are worse than nothing.

### D4: Sidebar spinner indicator

When a feed's URL is in `fetchingFeeds`, show a small inline spinner next to the feed title. The existing `SpinnerIcon` SVG component in `TopBar.tsx` is reused.

**Visual behavior:**
- Spinner replaces or appears before the unread count
- Uses the existing `spin` animation from `styles.css`
- Disappears when the feed is no longer in `fetchingFeeds`

**Rationale:** The sidebar is where the user sees the feed listed immediately after subscribing. The spinner confirms "this feed is being fetched" without requiring the user to navigate to that feed's view.

### D5: Loading message CSS

```css
.loading-message {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--subtext);
  opacity: 0;
  transition: opacity 0.25s ease-in;
}
.loading-message.visible { opacity: 1; }
```

The element starts invisible (`opacity: 0`) and fades in when the 500ms timer adds `visible`. The fade uses opacity only (GPU-composited, no repaint jitter). A `prefers-reduced-motion` media query drops the transition.

## Risks / Trade-offs

- **Message appears then items arrive instantly**: If the fetch completes just after the 500ms timer fires, the message is visible for only a few frames. Acceptable — it reads as the app catching up, and the fade-out is instant.
- **Message shown but no fetch in progress for that feed**: Race condition if the user navigates to a feed just as its fetch finishes. Mitigation: the check `items.length === 0` ensures the message only appears when there's truly nothing to show; if items are already stored, the existing river renders immediately.
- **Sidebar spinner flickering on rapid refreshes**: Possible if multiple sequential fetches overlap. Mitigation: the spinner is tied to `fetchingFeeds`, which tracks per-fetch lifetime; rapid start/stop is naturally smoothed by the fetch retry/error handling in the scheduler.
