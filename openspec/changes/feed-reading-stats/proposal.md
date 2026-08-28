## Why

Sift currently loses the long-term context needed to understand which feeds a user actually reads when article records are purged or a new device is paired. A durable, low-volume per-feed summary can show feed volume, articles read, relative reading preference, and expected reads without retaining article content or a detailed reading event log.

## What Changes

- Add a stats view that shows lifetime per-feed article volume, read-once counts, read rates, expected reads (`xR`), and a relative read index.
- Track monotonic per-feed counters locally for users without sync.
- Keep stats independent from article and feed-record retention so aggregate history survives content cleanup.
- Store aggregate stats for sync-enabled groups and make the server the authority for the synced snapshot.
- Make synced `readOnce` exact across the group with a monotonic per-item `everRead` marker, while keeping `totalSeen` as an approximate observed-volume aggregate.
- Pull stats during first-time sync so a newly paired device starts with the group's existing history instead of zeroed counters.
- Reconcile later updates opportunistically through normal sync without requiring real-time cross-device updates.
- Merge observed-volume snapshots monotonically, accepting small undercounts as the defined approximation for independent device updates.
- Keep the exact-once marker and the aggregate statistics independent from short-lived article records and current read/unread state.
- Keep the pre-existing local statistics migration baseline explicitly approximate until all future reads pass through the server-side `everRead` state.
- Preserve current read/starred synchronization separately from lifetime analytics counters.

## Capabilities

### New Capabilities

- `feed-reading-stats`: Durable local and synced per-feed reading aggregates, derived feed metrics, retention behavior, and the stats view.

### Modified Capabilities

- `device-sync`: Sync aggregate feed-reading stats during first-time and subsequent reconciliation, with server-authoritative monotonic merge behavior.

## Impact

- Browser IndexedDB schema and feed/item mutation paths for durable counter updates.
- New stats aggregation/query layer and first-class stats navigation/view in the SolidJS UI.
- Cloudflare D1 schema and sync push/pull payloads for small per-sync-group aggregate records.
- Sync first-time setup, normal pull/push reconciliation, and capability/version handling.
- Stats privacy surface for authenticated sync and agent pull consumers.
- No new third-party dependencies or article-content storage.
