## Context

See `proposal.md` for the motivation and scope. Sift is browser-first: feeds, article records, current read/starred state, and settings live in IndexedDB. The current `itemFlags` store mirrors current read/starred state, while D1 stores synchronized feed rows and current flag rows. Current sync pulls feed and flag rows using a monotonic cursor; it does not transfer article records or article content.

The existing `firstOpenedAt` field is a first-open marker used by article storage eviction. It is not a repeat-reading history and is not synchronized. The current read flag is synchronized, but it is mutable current state. Neither existing field alone is a durable cross-device lifetime statistic.

Current article cleanup removes cached extraction data under storage pressure and preserves item metadata. Explicit feed unsubscribe removes local feed items and flags. Server feed tombstones are separately cleaned after 30 days. Statistics therefore need their own persistence and lifecycle rather than being attached to article content or feed tombstone rows.

## Goals / Non-Goals

**Goals:**

- Persist compact per-feed lifetime `totalSeen` and `readOnce` aggregates locally.
- Keep aggregate history when article records or cached article content are cleaned up.
- Derive read rate, expected reads (`xR`), and relative read index from the counters.
- Make the stats view useful with sync disabled and with sync enabled.
- Bootstrap a new synced device with existing aggregate history.
- Make the server authoritative for synced snapshots, with exact group `readOnce` deduplication and approximate observed volume across independent devices.
- Preserve the existing current read/starred flag protocol as a separate concern.

**Non-Goals:**

- Exact group-wide deduplication of every observed article for `totalSeen`.
- Reading sessions, dwell time, reread counts, streaks, or a detailed activity timeline.
- Synchronizing article content, article inventory, or per-article analytics events.
- Reconstructing exact historical read times from existing `read_at` conflict timestamps.
- Changing the existing article retention policy.

## Decisions

### Store aggregates separately from articles

Add a dedicated local statistics store keyed by stable feed identity. Each record contains the lifetime counters and the latest title/URL snapshot needed to display history when the live feed record is unavailable. Add a compact local once-read marker store keyed by canonical item identity. It contains one durable bit per item that has contributed to `readOnce`, not a timestamped event log, and survives article/item cleanup so local rereads cannot create a second contribution.

The aggregate and marker stores are the durable long-term values. Article rows and cached HTML remain the source of short-term item content and current UI state, but their cleanup does not touch aggregate rows or once-read markers. A dedicated store is preferable to a single `meta` map because it avoids rewriting all feed statistics for every update and gives the records an explicit retention boundary.

Alternative considered: attach counters directly to `Feed`. Rejected because feed records have subscription/tombstone lifecycle semantics, while statistics need to outlive article and possibly feed cleanup.

### Count lifetime observations, not current unread state

`totalSeen` is incremented when a refresh creates a genuinely new item identity. It is an observed-volume count, not a globally exact article inventory. `readOnce` is incremented when an observed item first enters the read state. Marking an item unread never decrements the lifetime counter, and rereading never increments it.

Local non-synced accounting uses the independent once-read marker store. For synced accounting, the server owns a monotonic `everRead` marker keyed by canonical item identity, so the same item read by multiple devices contributes once. The marker is a bit of state, not an event log. Existing data before this change cannot reconstruct read-then-unread history and is seeded as an approximate baseline.

The local migration seeds a once-read marker when existing item data has a non-null `firstOpenedAt` or its current flag is read. It does not infer older read-then-unread transitions that are no longer represented. The same rule is used for the initial local `readOnce` baseline, so migration is idempotent and does not alter current read or starred state.

Alternative considered: count current `read` rows on every stats view. Rejected because unread actions would erase lifetime history and purged items would disappear from the summary.

### Use transparent relative metrics

The view shows raw counters and derives the ratios at read time:

```text
overallReadRate = sum(readOnce) / sum(totalSeen)
xR(feed)        = feed.totalSeen * overallReadRate
readIndex(feed) = feed.readOnce / xR(feed)
```

The volume and read numerator remain visible beside every percentage. The index is a volume-relative preference measure, not a prediction of article quality or future reading. The default ordering is absolute read count, with read rate and unread-equivalent backlog as alternate orderings. No opaque composite score is stored.

The stats baseline includes every current subscription, regardless of the river's selected feed, tag, or starred scope. Retained records for removed feeds remain data-only and do not enter the current-subscription baseline.

### Make synced aggregates server-authoritative high-water marks

Add a separate D1 `feed_stats` table keyed by sync key and the existing stable feed identity. The record stores the approximate `totalSeen` high-water mark, the server-derived `readOnce` aggregate, a display snapshot, and a server delivery timestamp. Add a monotonic `ever_read` bit to the existing per-item flag rows. The stats table and lifetime-read marker state are independent of the `feeds` table so feed tombstone cleanup cannot remove the aggregate.

Clients update local observed-volume records and enqueue `totalSeen` snapshots plus locally retained once-read markers through a dedicated statistics sync lifecycle. The server merges `totalSeen` with `max`, then returns the higher value and the server-derived `readOnce` through a dedicated statistics cursor. The server updates `readOnce` only when a read flag or historical marker transitions an item's `everRead` bit from false to true. Current read/unread state continues to use the existing flag timestamps.

`max` does not make independent `totalSeen` increments exactly additive. If two devices advance from the same baseline to the same next value, one observation increment can be lost. This is the accepted approximation for volume. Exact group-wide `readOnce` counts do not use `max`; the server-side `everRead` bit provides the deduplication primitive. A server read aggregate is authoritative for sync-enabled clients; a synced client may show a newly read article in its current read state before its lifetime aggregate is refreshed.

The server raises `totalSeen` to at least `readOnce` when necessary. This prevents impossible displayed ratios when devices have observed different subsets, but it does not turn `totalSeen` into an exact group-wide inventory.

To avoid a local read-count regression while an offline synced read is in flight, the client keeps unacknowledged once-read markers as pending local contributions. Its displayed synced `readOnce` is the server baseline plus pending markers that have not been acknowledged. A statistics push response SHALL acknowledge each submitted marker, whether it caused a new server transition or was already present; the client then removes that marker from pending and adopts the server-derived aggregate. A statistics pull SHALL also reconcile returned marker identities, so the same rule works after retries or first-time setup.

While pending markers are displayed, the local observed-volume value SHALL be raised to at least the displayed lifetime read count as a temporary derived-metric safety floor. This does not claim that the group volume is exact; the server's merged volume remains authoritative after acknowledgement.

Alternative considered: sync raw read events. Rejected because it creates an unbounded behavioral history and exposes more detail than the aggregate product requires. Alternative considered: merge `readOnce` snapshots with `max`. Rejected because it cannot deduplicate independent reads of the same item.

### Preserve subscription identity without inventing source identity

Use the existing `feedId` as the statistics identity for the lifetime of a subscription and sync feed row. URL and title edits preserve that identity. Aggregate records may remain after a feed row or article records are cleaned up, with the last-known label retained for recovery and future history presentation. A later subscription that receives a new feed identity starts a new local statistics series; automatic URL-based history merging is outside this change. If the server revives a tombstoned sync feed under its original identity, the revived identity also revives its existing statistics.

This keeps the identity model aligned with the current sync protocol and avoids a second canonicalization system. The server's existing tombstone-revival behavior may preserve a prior sync feed identity within its retention window; the client must reconcile statistics using the effective feed identity returned by sync rather than blindly using a newly generated local ID.

### Bootstrap and reconcile through a dedicated statistics sync lifecycle

First-time sync pulls remote statistics alongside the existing feed/flag setup. A new device adopts the remote baseline and once-read markers; a device with local history reconciles its observed-volume value with the higher remote value and submits locally retained once-read markers before completing setup. The server-derived `readOnce` aggregate and `everRead` markers are authoritative. Imported aggregate values are not re-counted from current flags.

Normal sync pushes newer local observed-volume snapshots and historical markers opportunistically and applies server aggregates on the existing boot, focus, online, and explicit-sync paths. Statistics use an independent cursor so an older client that ignores the feature cannot advance its delivery position. No real-time channel or separate polling loop is needed.

Use `GET /sync/stats/pull?since=<stats-cursor>` and `POST /sync/stats/push` for aggregate snapshots and historical markers. Store a separate local statistics cursor. The stats pull returns aggregate rows and the server's once-read markers; the stats push acknowledges submitted marker identities whether or not they caused a transition. The existing feed/flag pull remains unchanged. A stats push carries observed-volume snapshots and marker identities, never a client-authoritative `readOnce` value. Statistics rows use the same epoch-scaled, inclusive `row_at` cursor semantics as the ordinary sync feed/flag rows, but advance only the statistics cursor.

The statistics capability is advertised explicitly. New clients skip statistics sync against an older server instead of sending an unknown push field that an older server might silently ignore, while retaining local pending statistics. Existing feed and flag synchronization remains usable when aggregate stats are unavailable. Statistics pushes require the master sync key; authorized agent reads through the existing flag path still contribute to the server's `everRead` state. The stats pull may use the existing authenticated pull principals because the aggregate is part of the sync group state; it remains scoped to the sync key and is not exposed without sync authentication.

### Keep current flag synchronization separate

Current `read` and `starred` flags remain responsible for the inbox and reading UI. A pushed `read=1` also sets the server-side `everRead` bit and can increment the server aggregate once; a pushed or pulled `read=0` never clears it or decrements `readOnce`. A pulled current `read=1` is not independently counted by the client because the server aggregate is authoritative. A synced client may update its aggregate after the next statistics pull rather than immediately. The server's `read_at` value remains a conflict-resolution timestamp, not a historical analytics timestamp.

Any authenticated principal already authorized to push read flags, including an agent token, has the same lifetime-read semantics. Clients never submit an authoritative `readOnce` value for server merging; the server derives it from item-level once-read state. Aggregate volume snapshots remain trusted sync-group data and are bounded/validated by the server. Agent reads therefore count as accepted synced reads, while agents do not receive a separate counter-write operation.

### Use a first-class view with restrained presentation

Add `/stats` as a third application view alongside the river and reading view. The primary entry point is a labeled `Stats` CTA in the sidebar's bottom action area beside Palette and Settings, with an icon-only equivalent in the collapsed rail. The existing shell handles desktop and mobile layout. The page uses a compact summary and row-based feed comparison with proportional bars or simple text values; it does not require a charting dependency or a card-heavy dashboard.

Stats queries aggregate records directly and do not depend on the river's 500-item display limit. A statistics pull or local refresh invalidates the stats view so it reflects the latest local/server snapshot when the user returns to it.

## Risks / Trade-offs

- [Risk] Independent devices can advance `totalSeen` concurrently and lose one observation increment under `max` merge. -> [Mitigation] Document observed-volume approximation, keep raw counters visible, and do not present total volume as an exact cross-device article inventory.
- [Risk] A client can have a stale local `readOnce` value while a remote read is being pushed. -> [Mitigation] Treat the server-derived aggregate as authoritative, reconcile it through the dedicated statistics cursor, and do not increment it from pulled current flags.
- [Risk] A future purge that removes stable item identities can allow a replayed item to be counted as new locally. -> [Mitigation] Keep once-read markers in the independent local marker store; the synced server `everRead` state remains authoritative when available. `totalSeen` remains explicitly approximate for replayed observations.
- [Risk] Aggregate statistics in ordinary authenticated pull responses are visible to authorized agent-token consumers as well as devices. -> [Mitigation] Keep the payload aggregate-only, scope rows by sync key, and make this exposure explicit; introduce a narrower analytics scope only if agent access becomes unacceptable.
- [Risk] A newly paired device may have feed stats before it has fetched the corresponding article records. -> [Mitigation] Display aggregate counters independently of article availability and let later feed refreshes populate local item state.
- [Risk] An older server cannot persist a new statistics payload, or an older client can advance the shared feed/flag cursor past statistics rows. -> [Mitigation] Gate stats sync on the advertised capability and use a separate statistics endpoint/cursor.
- [Risk] Retained stats can outlive the live feed label. -> [Mitigation] Store the latest title and URL snapshot with the aggregate and keep stable feed identity separate from short-lived feed rows.

## Migration Plan

1. Advance the browser IndexedDB schema, create the local aggregate and once-read marker stores, and define an idempotent migration. Backfill `totalSeen` from existing item identities and seed local once-read markers from currently available read/open evidence as an explicitly approximate starting point.
2. Add the D1 `feed_stats` table and the monotonic `everRead` flag migration. Keep aggregate rows and lifetime-read markers independent from feed tombstone cleanup.
3. Add the statistics capability and dedicated push/pull endpoints/cursor, then deploy server/client protocol changes together. Older servers are handled by the capability gate and retain local pending statistics.
4. During first-time sync, pull the remote statistics baseline and once-read markers, reconcile local observed volume and locally retained markers, then process current flags without recounting the baseline.
5. If rollback is required, the previous client ignores the new statistics surface and continues current feed/flag sync; statistics remain stored and are recovered by a later compatible client.

## Open Questions

None for this scope. The initial stats view lists current subscriptions; retained records for removed feeds remain data-only and are not surfaced until a later feed-history presentation is explicitly designed.
