## Why

Clicking "Refresh all" has no immediate visual response — the spinning icon and disabled button only appear after `pullNow()` and `listFeeds()` complete. The gap is long enough that users wonder whether the click registered.

## What Changes

- Add an optimistic `inFlight` increment at the top of `refreshAll()` so the refresh button disables and icon spins instantly on click.
- Keep the spinner and disabled state active through the entire fetch cycle, bridging the gap until per-feed spinners appear in the sidebar.
- Export `setInFlight` from the scheduler module so it's accessible from `state.tsx`.
- Wrap the operation in `try/finally` to guarantee the counter is decremented even on error, preventing a stuck spinner.

## Capabilities

### New Capabilities
- `refresh-feedback`: The refresh-all action provides immediate tactile/visual confirmation on click and maintains that feedback until feed-level spinners appear.

### Modified Capabilities
- None. No existing specs to modify.

## Impact

- `src/feeds/scheduler.ts` — export `setInFlight` via `fetchingState`
- `src/state.tsx` — wrap `refreshAll` with optimistic +1 / deferred -1
