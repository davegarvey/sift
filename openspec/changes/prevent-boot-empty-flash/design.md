## Context

On boot, `AppProvider` (in `src/state.tsx`) renders immediately with empty signals: `feeds = []` and `items = []`. The boot IIFE then sequentially awaits `getSettings()` (first IndexedDB touch), a `/api/capabilities` fetch (network round-trip, state.tsx:526), `reloadFeeds()` (IndexedDB read), and `reloadItems()` (IndexedDB read). During that window — tens of milliseconds of IndexedDB latency plus a network round-trip — the river falls into `EmptyState`:

```
T0  render        feeds=[]   items=[]   → "Welcome to Sift"   (flash 1)
T1  reloadFeeds() feeds=[F]  items=[]   → "No items yet."     (flash 2)
T2  reloadItems() feeds=[F]  items=[I]  → real river
```

The root cause is `shouldShowSkeleton()` in `src/components/River.tsx`, which treats `feeds().length === 0` as "fresh install" rather than "not loaded yet". The only loading signals that exist (`fetchingState.inFlight`, `fetchingFeeds`) track *network* fetches, which are zero during boot, so nothing can express "IndexedDB hydration is in progress".

## Goals / Non-Goals

**Goals:**
- No empty state is visible before hydration completes
- Show the existing shimmer skeleton cards during hydration so the UI never looks dead
- Guarantee the loading state is always released (even if an IndexedDB read throws) so the app can never be stuck on skeletons
- Keep the change minimal — a few lines in two files, no CSS changes

**Non-Goals:**
- Fixing the sidebar's feed list pop-in at boot (no empty-state text there, much less noticeable)
- Fading/animating the transition from skeleton to content
- Reducing the actual IndexedDB read latency
- Skeleton states for the reading view or other panels

## Decisions

### D1: A single `hydrated` signal in `AppContext`

Add to `src/state.tsx`:

```ts
const [hydrated, setHydrated] = createSignal(false);
```

Set to `true` in a `finally` that wraps the **entire boot IIFE body** — from `getSettings()` (the first IndexedDB touch, which can reject on a blocked upgrade or storage-quota error) through the pair-code block. The cleanest shape is a `finally` chained on the IIFE itself:

```ts
void (async () => {
  const s = await getSettings();
  // ...capabilities fetch, reloadFeeds, reloadItems, hash restore,
  //    startScheduler, bootSync, pair-code handling...
})().finally(() => setHydrated(true));
```

Expose `hydrated` on the context interface as `hydrated: () => boolean`.

**Alternatives considered:**
- Two flags (`feedsHydrated`, `itemsHydrated`) — finer-grained but unnecessary; the single flag stays `false` until both reads settle, which is exactly the window where both flashes occur
- Setting the flag right after `reloadFeeds()` — would still flash "No items yet." between the feeds read and the items read, so rejected
- A boolean on `AppState` — the store is for view/UI state; a signal is consistent with `feeds`/`items`
- `try/finally` starting at `reloadFeeds()` only — the IndexedDB failure that matters most (a rejected `openDB`/`getDb` at `getSettings()`) would happen *before* the try, leaving `hydrated` false forever and the river stuck on skeletons with no error surface; rejected

**Rationale:** A single flag covers both flash frames, is trivially testable, and the whole-IIFE `finally` guarantees liveness no matter where boot fails. The name `hydrated` reflects that IndexedDB reads (not network fetches) are what it guards. As a side effect, the pair-code boot (network redeem + first-time pull) also keeps the river in a loading state until pairing settles, instead of flashing "Welcome to Sift".

### D2: Hydration check first in `shouldShowSkeleton()`

In `src/components/River.tsx`:

```ts
const shouldShowSkeleton = () => {
  if (visibleItems().length > 0) return false;
  if (!ctx.hydrated()) return true;          // ← new: still hydrating from IndexedDB
  if (ctx.feeds().length === 0) return false;
  const fetching = ctx.fetchingFeeds();
  if (ctx.state.riverScope == null) return fetching.size > 0;
  return fetching.has(ctx.state.riverScope);
};
```

**Alternatives considered:**
- Gate `EmptyState` internally (`if (!ctx.hydrated()) return null`) — keeps the fallback expression in `River` unchanged but gives `EmptyState` knowledge of loading, which it shouldn't have; rejected
- Render nothing until hydrated — blank screen instead of skeleton; rejected for being less polished than the existing shimmer cards

**Rationale:** Placing the check first preserves all existing fetch-in-flight behavior after hydration. On a genuinely empty database (first run), the user briefly sees skeletons, then the unchanged "Welcome to Sift" — no flash, no dead screen.

### D3: No changes to the skeleton visuals

Reuse the existing `SkeletonState` component and shimmer CSS unchanged. The skeleton is already the established "content is coming" language of the river.

## Risks / Trade-offs

- **Skeleton flash on first run**: A brand-new user with an empty database sees ~100ms of skeleton cards before "Welcome to Sift". This is intentional — it is better than the current flash of "Welcome to Sift" for *returning* users with data — and it reads as the app "checking".
- **Boot rejection skips scheduler setup**: If the boot IIFE rejects before `startScheduler()`, the scheduler, visibilitychange handler, and `bootSync` never run — a pre-existing failure mode (today it silently breaks refresh). The whole-IIFE `finally` ensures `hydrated` still flips, so the river degrades to a usable empty state rather than a permanent shimmer screen. Rooting out the pre-existing rejection paths is out of scope.
- **Deep-link to an item**: When the boot hash-restore opens the reading view, the river is not mounted and the flag is irrelevant; the reading view renders as today.
