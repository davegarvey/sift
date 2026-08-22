## 1. Module exports

- [x] 1.1 Export `setInFlight` from `scheduler.ts` via the `fetchingState` object

## 2. state.tsx

- [x] 2.1 Add optimistic `setInFlight(n => n + 1)` at the top of `refreshAll()`
- [x] 2.2 Wrap `pullNow()` + `refreshStaleFeeds(true)` in `try/finally` with `setInFlight(n => Math.max(0, n - 1))` in the `finally` block
