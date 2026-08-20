## Context

The refresh-all action (`state.tsx:refreshAll`) currently calls `pullNow()`, then `refreshStaleFeeds(true)`, then reloads from IndexedDB. The `inFlight` signal (which drives the button's `disabled` state and the spinning icon) is only incremented inside `refreshFeed()` (`scheduler.ts:98`), which is gated behind `pullNow()` + `listFeeds()` — both async operations that can take 10ms–15s.

## Goals / Non-Goals

**Goals:**
- `inFlight` goes to 1 synchronously on click, before any `await`.
- The button stays disabled and icon spins continuously until per-feed spinners take over (i.e., no gap where `inFlight` drops back to 0 between the optimistic increment and the first `refreshFeed` increment).
- Errors don't leave the counter stuck.

**Non-Goals:**
- Loading overlays, toasts, or the River showing a "refreshing" state (out of scope).
- Changing the concurrency of feed fetches.
- Changing the background auto-refresh tick.

## Decisions

1. **Export `setInFlight` directly** rather than adding a wrapper function. It's a simple signal setter — a wrapper adds indirection with no benefit.

2. **`try/finally` scoped over the entire fetch phase** (`pullNow` + `refreshStaleFeeds`) to guarantee the optimistic increment is always balanced, even on error. The decrement happens **before** `reloadFeeds`/`reloadItems` to preserve the existing behavior where the spinner shuts off once fetching is done (the per-feed spinners also disappear at this point).

3. **Decrement uses `Math.max(0, n - 1)`** matching the pattern already used in `refreshFeed`'s `finally` block. Guards against negative drift from any hypothetical double-decrement scenario.

4. **No change to `refreshStaleFeeds` itself.** The optimistic increment is in `refreshAll` only — the background tick calls `refreshStaleFeeds` directly and doesn't need optimistic feedback.

## Risks / Trade-offs

- **Error in `reloadFeeds` or `reloadItems` (outside `finally`)** → the optimistic counter was already decremented, so the button isn't stuck. The user sees stale state but can click refresh again. Acceptable — reload errors are rare (IDB read failures).
- **Spinner shuts off before UI updates** → the gap is typically <50ms (IDB reads), and the per-feed spinners disappear at the same time the main spinner does. This matches current behavior.
