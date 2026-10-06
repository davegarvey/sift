## 1. Refresh Scope Core

- [x] 1.1 Add the canonical read-only feed-ID target type and selection resolver, including normalized OR-based tags and starred-filter independence.
- [x] 1.2 Extend the scheduler refresh entry point to filter by explicit target IDs while preserving force-refresh behavior for manual actions and stale-only behavior for background actions.
- [x] 1.3 Add per-feed refresh promise coalescing so background and manual requests cannot duplicate an upstream fetch.
- [x] 1.4 Serialize shared sync pulls across manual, online, visibility, and catch-up triggers.
- [x] 1.5 Update manual refresh orchestration to capture its target before sync, coalesce repeated triggers, suppress callbacks for the transaction, and attempt final feed/item reloads after errors.
- [x] 1.6 Separate manual refresh in-flight feedback from background/per-feed fetching state.
- [x] 1.7 Make concurrent item reload callers share the in-flight reload promise.

## 2. Explicit Import Refresh

- [x] 2.1 Return the created feed ID from the subscription service and collect imported IDs from OPML merge.
- [x] 2.2 Add an explicit feed-ID refresh context operation that skips the ordinary sync pull, and use it after OPML import so every imported feed is fetched regardless of UI selection.
- [x] 2.3 Keep empty OPML imports from issuing upstream feed fetches.

## 3. UI Entry Points

- [x] 3.1 Route sidebar, keyboard, command-palette, and empty-state manual refresh actions through selected refresh.
- [x] 3.2 Update refresh button titles, accessible names, command labels, and shortcut text to describe scoped refresh behavior, and hide the collapsed refresh control when no feeds exist.
- [x] 3.3 Make the empty-state refresh action keyboard-focusable and semantically actionable.

## 4. Verification

- [x] 4.1 Add tests covering all-feed, single-feed, multi-tag, empty-target, and starred-plus-scope selection behavior.
- [x] 4.2 Add tests proving background refresh remains global, duplicate feed work is coalesced, and OPML import targets every imported feed without refreshing an empty import.
- [x] 4.3 Add coverage for manual callback suppression, independent manual feedback state, and reload/error cleanup where practical.
- [x] 4.4 Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [x] 4.5 Validate the OpenSpec change and confirm all task checkboxes are complete.
