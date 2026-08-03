## 1. Hydration signal

- [x] 1.1 Add `hydrated` signal to `src/state.tsx` — `const [hydrated, setHydrated] = createSignal(false)`, expose `hydrated: () => boolean` on the `AppContext` interface and value
- [x] 1.2 Chain `setHydrated(true)` via a `finally` on the **entire boot IIFE** (from `getSettings()` through the pair-code block), so a failure at any point — including a rejected `getDb`/`openDB` — still releases the loading state

## 2. River gating

- [x] 2.1 In `src/components/River.tsx`, add `if (!ctx.hydrated()) return true;` as the first check in `shouldShowSkeleton()`, before the feeds-length check, so the skeleton shows during hydration instead of any empty state

## 3. Verification

- [x] 3.1 `npm run typecheck` and `npm run lint` pass
- [ ] 3.2 Manual: throttle IndexedDB (or add a temporary delay) and confirm returning users see skeletons, never "Welcome to Sift" / "No items yet." during boot
- [ ] 3.3 Manual: fresh profile (empty DB) still ends on "Welcome to Sift" after hydration; existing fetch-in-flight skeleton behavior on refresh is unchanged
- [x] 3.4 Add `tests/boot-empty-flash.smoke.ts` (Playwright) — load the app with seeded data, assert the skeleton is present before hydration settles and that no empty-state headline is ever visible pre-hydration
