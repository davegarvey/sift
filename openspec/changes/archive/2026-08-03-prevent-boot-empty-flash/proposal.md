## Why

On startup, the river briefly flashes "Welcome to Sift" and then "No items yet." before IndexedDB finishes hydrating feeds and items. The UI cannot distinguish "still loading from IndexedDB" from "truly empty", so returning users see a wrong, confusing empty state for a few hundred milliseconds.

## What Changes

- **Hydration signal in app state**: Add a `hydrated` signal to `AppContext` that becomes `true` once the boot sequence finishes (a `finally` chained on the entire boot IIFE, so a failed IndexedDB read or hung capabilities fetch still releases the loading state)
- **Loading state takes priority while hydrating**: In the river, when there are no visible items and the app has not finished hydration, show the existing skeleton loading cards instead of any empty state
- **Empty states gated on hydration**: "Welcome to Sift", "No items yet.", and the starred-empty states only render after hydration completes — they remain unchanged in behavior for genuinely empty databases

No breaking changes. No new dependencies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reader-ui`: The river loading state takes priority not only while a feed fetch is in flight, but also while the app is hydrating feeds/items from IndexedDB on startup. Empty states are only shown after hydration completes, and hydration completion is guaranteed even if the IndexedDB read fails.

## Impact

- `src/state.tsx` — add `hydrated` signal to the context interface; set it via a `finally` chained on the whole boot IIFE
- `src/components/River.tsx` — `shouldShowSkeleton()` returns `true` while not hydrated (before the existing feeds/fetching checks)
- `tests/boot-empty-flash.smoke.ts` — Playwright smoke test asserting no empty state is visible before hydration (no new dependencies)
