## Context

Sync restores subscription records, read flags, and statistics, but article items are fetched and stored locally. The scheduler starts before a newly paired device has subscriptions and applies its ordinary cadence to feeds once they arrive. See `proposal.md` for the user-visible problem.

## Goals / Non-Goals

**Goals:**
- Refresh the post-merge feed list immediately after first-time pairing.
- Tell users when an empty river is waiting on those feed requests.
- Keep the normal background scheduler cadence unchanged.

**Non-Goals:**
- Sync article contents between devices.
- Add granular item counts or a separate pairing progress workflow.
- Change retry behavior, concurrency limits, or stored feed state.

## Decisions

### Reuse the explicit feed refresh operation after pairing

After first-time setup succeeds and feeds/items are reloaded, pass the current feed IDs to the existing `refreshFeeds` operation. Start it in the background so pairing confirmation is not held until every feed finishes. Route pairing links through `pairSyncWithKey`, giving code, key, QR, and link entry points the same behavior. A failed first-time setup does not start this refresh.

Alternative considered: changing the scheduler's initial cadence. That would affect normal background behavior for all subscriptions, while the delay only needs correction for first-time pairing.

### Use per-feed fetch state for the river message

Use the existing `fetchingFeeds` set to determine when the visible river scope is being fetched. Display “Fetching your feeds…” during active feed requests and keep “Loading…” for startup hydration before a feed request begins. The existing delayed appearance avoids flashing the message during quick requests.

Alternative considered: adding a pairing-specific UI signal. The scheduler already exposes the fetch lifecycle, so a second state source would duplicate it and could drift out of sync.

## Risks / Trade-offs

- [A large subscription list takes time to fetch] → Start with the scheduler's existing concurrency and per-feed error handling; the pairing flow returns while the requests continue.
- [A feed request fails] → Existing feed error and retry behavior remains responsible for recovery; the loading message ends when that request ends.

## Migration Plan

No data migration is required. The client refreshes feeds after pairing using the existing local database and scheduler paths. Rolling back restores the prior delayed background refresh behavior.
