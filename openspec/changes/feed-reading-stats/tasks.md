## 1. Local Statistics Storage

- [x] 1.1 Add the local per-feed statistics record and dedicated IndexedDB store, including server baseline and pending-marker state, a schema version migration, and last-known feed label fields.
- [x] 1.2 Add the local once-read marker store and update item/read mutation paths so new observations increment `totalSeen`, first reads increment local `readOnce`, rereads do not increment, and unread actions never decrement.
- [x] 1.3 Backfill local statistics from existing item, first-open, and flag data using the specified `firstOpenedAt`-or-current-read seed rule, without disturbing current read/starred state, and preserve statistics through article/content cleanup.
- [x] 1.4 Make item, once-counted marker, and local feed-stat updates transactional, including duplicate identities in one refresh batch and duplicate read calls for one item.
- [x] 1.5 Reconcile local statistics for remote current flags without independently recounting a server-provided `readOnce` baseline, while retaining unacknowledged local markers as pending contributions, maintaining the local volume safety floor, and applying server-provided once-read markers to the local marker store.

## 2. Derived Metrics

- [x] 2.1 Add a statistics query/aggregation service that reads all current-subscription feed aggregates without the river's display limit or current river scope.
- [x] 2.2 Implement read rate, expected reads (`xR`), read index, unavailable-baseline handling, and absolute/relative ordering rules from the specification.
- [x] 2.3 Add coverage for new-item deduplication, first-read-only counting, unread/reread behavior, cleanup retention, zero-volume feeds, approximate-volume labels, and metric calculations.

## 3. Server Statistics Authority

- [x] 3.1 Add the D1 `ever_read` migration to the existing flag state and implement atomic false-to-true deduplication for accepted read pushes, while preserving current read/unread conflict semantics.
- [x] 3.2 Add the D1 aggregate statistics table, indexes, schema bootstrap migration, and retention behavior independent of feed tombstone cleanup.
- [x] 3.3 Add dedicated statistics capability, push, and pull contracts with an independent cursor; transport aggregate counters, once-read markers, and feed identity metadata without article content or event history.
- [x] 3.4 Implement server-authoritative `readOnce` aggregation from `ever_read`, monotonic `max` merging for approximate `totalSeen` snapshots, and the `totalSeen >= readOnce` invariant.
- [x] 3.5 Preserve sync authentication, scoping, validation, bounds, and no-user-data logging guarantees for statistics and lifetime-read payloads.
- [x] 3.6 Add server and local-D1-shim tests for scoped storage, exact ever-read deduplication, max volume merging, stale snapshots, tombstone cleanup, capability negotiation, and payload handling.

## 4. Client Sync Integration

- [x] 4.1 Extend the sync queue and statistics push path to enqueue newer local `totalSeen` snapshots and once-read markers with existing debounce, retry, failure-retention behavior, and marker acknowledgements.
- [x] 4.2 Apply remote statistics and server-derived `readOnce` values using the independent statistics cursor during normal pulls and first-time setup, preserving higher local volume history and unacknowledged read contributions when joining a group.
- [x] 4.3 Ensure first-time sync bootstraps an empty device without recounting current read flags, uploads locally retained read markers, and preserves local statistics against unsupported servers.
- [x] 4.4 Add client sync tests for first-time bootstrap, local-history preservation, offline upload, pending-marker acknowledgement, remote convergence, exact same-item reads across devices, and read/unread interaction.

## 5. Stats View And Navigation

- [x] 5.1 Add the `/stats` application view and route handling alongside the river and reading views.
- [x] 5.2 Add a labeled Stats CTA to the sidebar bottom action area and an icon-only collapsed-rail equivalent using Lucide icons, preserving existing navigation and selection behavior.
- [x] 5.3 Build the responsive stats view with overall totals, per-feed volume/read/read-rate/xR/read-index values, sorting, loading, empty, and unavailable states.
- [x] 5.4 Refresh displayed statistics after local refreshes and completed statistics sync application without triggering a feed fetch solely to render the page.
- [x] 5.5 Add responsive and accessibility coverage for desktop, mobile, keyboard navigation, zero-data feeds, and retained labels.

## 6. Documentation And Verification

- [x] 6.1 Update README privacy and architecture text to describe aggregate statistics, server-side `everRead` state, and their sync/agent scope.
- [x] 6.2 Update the public OpenAPI document for statistics capability, statistics pull/push, and the agent-visible aggregate scope.
- [x] 6.3 Run `openspec validate "feed-reading-stats" --type change --strict` and resolve artifact validation errors.
- [x] 6.4 Run `npm run typecheck`, `npm run lint`, and `npm test` after implementation and resolve failures.
