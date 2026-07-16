## 1. Core Change

- [x] 1.1 Add `pullNow()` call at the start of `refreshAll()` in `src/state.tsx`, before `refreshStaleFeeds(true)`
- [x] 1.2 Verify the change compiles (`npm run typecheck`)
- [x] 1.3 Run lint (`npm run lint`)

## 2. Verification

- [x] 2.1 Confirm non-synced clients are unaffected (sync pull is a no-op without a sync key)
- [x] 2.2 Confirm `pullNow()` error handling doesn't surface errors to the user when the sync server is unreachable
