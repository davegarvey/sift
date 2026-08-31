# feed-reading-stats Specification

## Purpose

Provide a durable, compact view of how much content each feed produces and how much of it the user reads, without retaining article content or a detailed reading event history.

## Requirements

### Requirement: Durable per-feed lifetime counters

The system SHALL maintain independent lifetime counters for each feed's observed article volume and read-once activity. The `totalSeen` counter SHALL increase when a new article identity is first observed locally. The `readOnce` counter SHALL increase at most once for each canonical article identity when that article first enters the read state. Neither counter SHALL decrease when an article is marked unread, read again, or removed from the article store. For a sync-enabled group, `readOnce` SHALL be authoritative for reads accepted by the server, while `totalSeen` SHALL remain an approximate aggregate of article observations made by participating devices.

The system SHALL retain a compact once-read marker independently of mutable current read state. The marker SHALL not record a detailed event history.

For existing local data, the initial once-read marker SHALL be seeded when an item has a non-null `firstOpenedAt` or is currently marked read. Existing read-then-unread history that is not represented by either value SHALL not be inferred.

For a sync-enabled client, a locally created once-read marker that has not yet been acknowledged by the server SHALL remain a pending local contribution. Reconciliation SHALL not discard that pending contribution or visibly reduce the local `readOnce` value; once the server acknowledges the marker, the server-derived aggregate SHALL become the authoritative baseline.

#### Scenario: New article increases feed volume once

- **WHEN** a refresh observes an article identity that has not previously been observed for the feed
- **THEN** the feed's `totalSeen` counter SHALL increase by one
- **AND** a later refresh containing the same article identity SHALL NOT increase `totalSeen` again

#### Scenario: First read increases the lifetime read count once

- **WHEN** an observed article first enters the read state through reading or a read action
- **THEN** the feed's `readOnce` counter SHALL increase by one

#### Scenario: The same article is read on two synced devices

- **WHEN** two devices in the same sync group read the same canonical article identity
- **THEN** the group's `readOnce` count SHALL include that article only once
- **AND** the current read state SHALL continue to synchronize through the existing read-flag behavior

#### Scenario: Offline synced read remains visible until acknowledged

- **WHEN** a sync-enabled client reads an article while offline
- **THEN** it SHALL retain the once-read marker as a pending local contribution
- **AND** its local lifetime read count SHALL not decrease when a lower server baseline is later applied
- **AND** its local displayed observed volume SHALL remain at least as large as its displayed lifetime read count
- **AND** the pending contribution SHALL be reconciled when the server acknowledges whether the marker was new or already present

#### Scenario: Unread and reread do not change lifetime read count

- **WHEN** an article that has already contributed to `readOnce` is marked unread and later read again
- **THEN** `readOnce` SHALL remain unchanged

#### Scenario: Once-read marker survives article cleanup

- **WHEN** an article's content, metadata, or current flag row is removed by retention or cleanup
- **THEN** the once-read marker SHALL remain available to prevent a later observation of the same canonical identity from incrementing `readOnce` again

#### Scenario: Article cleanup does not erase aggregate history

- **WHEN** an article record or its cached content is removed by retention or storage cleanup
- **THEN** the feed's `totalSeen` and `readOnce` counters SHALL remain unchanged

#### Scenario: Reappeared article affects only approximate volume

- **WHEN** an article identity is observed again after its local identity record has been fully removed
- **THEN** the local `totalSeen` counter MAY treat that observation as new
- **AND** the once-read marker SHALL still prevent a second `readOnce` contribution when the marker is retained

#### Scenario: Non-synced users retain local statistics

- **WHEN** sync is disabled
- **THEN** counter updates SHALL continue to be recorded locally
- **AND** no network request SHALL be required to read or update the statistics

### Requirement: Transparent derived feed metrics

The system SHALL derive feed metrics from the lifetime counters rather than storing separate percentages or scores. For a feed with `totalSeen > 0`, its read rate SHALL be `readOnce / totalSeen`. Across the displayed feed population, the overall read rate SHALL be `sum(readOnce) / sum(totalSeen)`. A feed's expected reads (`xR`) SHALL be its `totalSeen` multiplied by the overall read rate, and its read index SHALL be `readOnce / xR` when `xR > 0`. A sync-enabled aggregate SHALL maintain `totalSeen >= readOnce` so derived metrics cannot produce a read rate above 100 percent solely because devices observed different article subsets. The view SHALL identify `totalSeen` as observed volume and SHALL identify the resulting relative metrics as approximate when the volume was merged across devices.

The stats view SHALL identify the volume denominator as observed article volume. Relative metrics for a sync-enabled group inherit the approximation of `totalSeen`, even when the group's `readOnce` count is exact for server-accepted reads.

#### Scenario: Read rate describes feed follow-through

- **WHEN** a feed has observed and read-once counters
- **THEN** the stats view SHALL show the feed's read count, volume, and read rate
- **AND** the read rate SHALL be calculated from those counters rather than persisted independently

#### Scenario: Expected reads use feed volume as the baseline

- **WHEN** the displayed population contains 1,000 observed articles and 200 read-once articles in total
- **AND** a feed has 100 observed articles
- **THEN** that feed's overall baseline SHALL be 20 percent
- **AND** its `xR` SHALL be 20 expected reads

#### Scenario: Read index identifies over- and under-read feeds

- **WHEN** a feed has 50 read-once articles and an `xR` of 20
- **THEN** its read index SHALL be 2.5x
- **AND** an index above 1x SHALL indicate that the feed is read more than its volume would predict

#### Scenario: Relative metrics have no false precision without a baseline

- **WHEN** the displayed population has no observed articles or no expected reads
- **THEN** the stats view SHALL omit or mark the read rate, `xR`, and read index as unavailable
- **AND** SHALL still show any available absolute counters

### Requirement: Stats view exposes absolute and relative usage

The system SHALL provide a first-class stats view for subscribed feeds. The view SHALL calculate its overall baseline from all current subscriptions, independent of the river's current feed, tag, or starred scope. The view SHALL show overall totals and a per-feed listing containing at least observed volume, read-once count, read rate, expected reads, and read index. The listing SHALL support ordering by absolute read count, read rate, and unread-equivalent backlog (`totalSeen - readOnce`). The backlog label SHALL make clear that it is a lifetime not-yet-read-once estimate, not the current mutable unread count.

#### Scenario: User compares prolific and preferred feeds

- **WHEN** the user opens the stats view
- **THEN** the user SHALL be able to compare a feed's absolute read count with its volume-relative read index
- **AND** the view SHALL show the numerator and denominator used for the read rate

#### Scenario: Stats baseline ignores river scope

- **WHEN** the user has selected one feed, tag, or starred-only filter in the river
- **AND** the user opens the stats view
- **THEN** the overall totals and relative metrics SHALL still use all current subscriptions

#### Scenario: Empty feed has no misleading percentage

- **WHEN** a subscribed feed has no observed articles
- **THEN** the feed SHALL appear with zero volume and zero read-once count
- **AND** its read rate and relative metrics SHALL be shown as unavailable rather than 0 percent

#### Scenario: Stats view works without a refresh

- **WHEN** the user opens the stats view while offline or before a new feed refresh
- **THEN** the view SHALL render from locally stored aggregates
- **AND** it SHALL NOT trigger a feed fetch solely to display statistics

### Requirement: Aggregate retention is independent of article retention

The system SHALL store feed statistics separately from article content and SHALL NOT remove aggregate statistics when cached article HTML, article metadata, or other short-lived article records are evicted. Aggregate records SHALL retain the feed identity and enough feed-label information to remain understandable if the live feed record is temporarily unavailable. Any once-counted identity marker required for local exactness SHALL be retained independently of cached article content.

#### Scenario: Cached article content eviction preserves stats

- **WHEN** storage pressure removes an article's extracted content
- **THEN** all affected feed statistics SHALL remain available without recalculation from the article body

#### Scenario: Feed metadata cleanup preserves aggregate identity

- **WHEN** a feed record is removed by a retention or cleanup process
- **THEN** its retained aggregate record SHALL keep its stable feed identity and last-known display label

### Requirement: Feed identity determines a statistics series

The system SHALL use the stable feed identity as the key for a statistics series. Editing a feed URL or title SHALL preserve that series. A new subscription with a different feed identity SHALL start a new series, while a synchronized tombstone revival that restores the original feed identity SHALL restore its existing series.

#### Scenario: Feed metadata edit preserves statistics

- **WHEN** a subscribed feed's URL or title is edited
- **THEN** its existing aggregate statistics SHALL remain associated with the same feed identity

#### Scenario: New subscription starts a separate series

- **WHEN** a feed is unsubscribed and later subscribed again under a new feed identity
- **THEN** the new subscription SHALL not automatically merge with the old statistics series

#### Scenario: Sync tombstone revival restores a series

- **WHEN** sync revives a tombstoned feed under its original feed identity
- **THEN** the revived feed SHALL use the aggregate statistics associated with that identity

#### Scenario: Pairing canonicalizes a duplicate local identity

- **WHEN** a local feed URL matches a synced feed URL but the local and remote feed identities differ
- **THEN** the local feed statistics SHALL be re-keyed to the remote feed identity
- **AND** local once-read markers for that feed SHALL be re-keyed with the same identity
- **AND** the existing aggregate values SHALL be preserved
