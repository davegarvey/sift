## Context

The UI already stores a mutually exclusive single-feed scope (`riverScope`) and OR-based tag scopes (`activeTags`). `refreshStaleFeeds()` currently accepts a force-all flag and is also used by the background scheduler. Manual refresh is orchestrated in `state.tsx`, while OPML import currently adds feeds and then invokes the same manual refresh entry point. The current shared in-flight counter also drives the sidebar CTA even for background fetches.

## Goals / Non-Goals

**Goals:**

- Represent manual refresh scope as an explicit target set that can distinguish all feeds from no matching feeds.
- Derive the target once from the current UI state before sync can change local feed metadata.
- Keep background refresh global and stale-aware.
- Give OPML import an explicit target containing the newly imported feed IDs.
- Keep manual feedback state separate from per-feed/background fetch state.
- Serialize overlapping manual operations and coalesce overlapping feed fetches.
- Preserve manual refresh feedback, sync pull, callback suppression, and final signal reload behavior.

**Non-Goals:**

- Changing the background scheduler cadence, stale calculation, concurrency limit, or retry policy.
- Treating the starred-item filter as a feed refresh scope.
- Adding persistent refresh preferences or a new selection mode.
- Changing server-side sync behavior.

## Decisions

### Use an explicit target set alongside force-refresh mode

The scheduler will receive options containing a force-refresh flag and an optional feed-ID target. An omitted target means the background scheduler may inspect all feeds, while an explicit empty target means no feeds. Manual refresh will always materialize a concrete `Set` of IDs, including the All view, at invocation time. This prevents an active tag selection with no matches from falling through to the all-feeds behavior and prevents a sync pull from changing a click's target.

The background scheduler will continue calling the scheduler without a target, so it will inspect every feed and refresh only feeds that are stale or retryable. Manual refresh will pass `force = true` plus the captured target, preserving the current behavior of bypassing freshness checks for the requested feeds.

Alternative considered: filtering the feed list in the UI and calling `refreshFeed()` directly. This would duplicate scheduler concerns such as concurrency, eviction, and error handling, so the target belongs at the scheduler boundary instead.

### Capture selection before the sync pull

The manual refresh coordinator will resolve the current selection to feed IDs before calling `pullNow()`. A sync pull can add, remove, or retag feeds; capturing first makes one click deterministic and avoids changing the refresh set halfway through the operation. A second ordinary manual trigger while an operation is active will return the active operation; an explicit OPML target will wait behind the active operation rather than being dropped.

The selection resolver will use `riverScope` first, then match normalized feed tags using existing OR semantics, and otherwise materialize all currently loaded feed IDs. `starredOnly` will not participate because it filters items rather than subscriptions. The canonical target type is a read-only set of feed IDs; the scheduler's omitted-target form is reserved for background refresh.

### Prevent overlapping fetch and pull work

The scheduler will retain a promise per feed while that feed is being fetched. Concurrent background and manual requests for the same feed will await the existing operation instead of issuing duplicate upstream requests. Sync pull entry points will likewise share an in-flight pull promise so keyboard, online, visibility, and manual triggers do not pull concurrently.

Alternative considered: allowing duplicate work and relying only on the disabled button. That does not cover keyboard shortcuts, background ticks, or online events, and can produce inconsistent last-write timing.

### Separate manual feedback from background fetch state

The application context's `fetching()` value used by the refresh CTA will track the manual refresh transaction only. The scheduler will continue exposing per-feed fetching state for row spinners, but background activity will not disable or spin the global refresh control.

### Preserve reloads and callback suppression on failure

The manual transaction will keep its callback-suppression guard active through the final feed and item reload attempts. Unexpected fetch/storage errors will be recorded, both reloads will still be attempted, and the manual state will be cleared in `finally`. `reloadItems()` will coalesce concurrent callers onto the in-flight reload promise so the final manual reload is not skipped by an earlier reload.

### Separate selected refresh from explicit feed refresh

The application context will expose a selected-refresh operation for normal user actions and an explicit feed-ID refresh operation for workflows that know their target. The OPML merge will collect IDs returned by each subscription, reload the feed list, and invoke the explicit operation for those IDs. The import-specific operation will skip the ordinary sync pull because the imported IDs are already the authoritative local target and must be fetched before a remote merge can replace them.

Alternative considered: temporarily changing the UI selection during import. That would create visible state churn and could race with user navigation, so the import target will remain explicit and side-effect free.

### Use scope-aware copy and accessible labels

The sidebar refresh button will describe all-feed, single-feed, or selected-feed behavior based on the current scope. The command palette and keyboard shortcut will use selected-refresh terminology rather than promising an all-feed refresh. The manual counter will drive the global button, while the per-feed set continues to drive feed-row spinners.

## Risks / Trade-offs

- [A tag can match no feeds after sync or deletion] → Preserve an explicit empty target and still perform the normal final UI reload without issuing upstream requests.
- [Selection changes while a refresh is running] → Capture the target at invocation time; the next manual action uses the new selection.
- [An imported feed fails immediately after import] → Route it through the existing per-feed error and retry state, and keep the import operation's refresh promise subject to the existing explicit-refresh error handling.
- [Renaming the context operation touches multiple UI entry points] → Update all current callers and the test context together, with typecheck catching omissions.

## Migration Plan

No data migration is required. Deploy the client changes atomically; existing persisted feed IDs, tags, retry state, and sync state remain compatible. If rollback is needed, the prior client will continue to read the unchanged IndexedDB schema.
