## ADDED Requirements

### Requirement: Sync aggregate feed-reading statistics

When sync is enabled, the system SHALL synchronize per-feed lifetime statistics as small aggregate records scoped to the sync key. The aggregate records SHALL contain counters and feed identity metadata only; they SHALL NOT contain article content or a detailed reading event log. The server SHALL retain a monotonic per-item `everRead` bit in the existing synced flag state solely to deduplicate lifetime reads. Statistics SHALL use a dedicated authenticated push/pull path and cursor rather than the ordinary feed/flag cursor.

#### Scenario: Statistics pull includes aggregate statistics

- **WHEN** an authenticated sync client performs an initial or incremental statistics pull
- **THEN** the response SHALL include any feed-stat records at or after the requested statistics cursor
- **AND** each record SHALL be scoped to the authenticated sync key

#### Scenario: Statistics transport does not carry article content

- **WHEN** a client sends or receives a statistics synchronization payload
- **THEN** the payload SHALL contain only feed identities, aggregate counters, feed-label snapshots, and once-read marker identities
- **AND** it SHALL NOT contain article content, article titles, excerpts, links, or a timestamped event history

#### Scenario: Sync-off client sends no statistics

- **WHEN** sync is disabled
- **THEN** the client SHALL not send aggregate statistics to the server
- **AND** local statistics SHALL continue to work without server access

### Requirement: Server is authoritative for synced aggregate values

The server SHALL maintain one aggregate statistics record per sync key and feed identity. The `totalSeen` counter SHALL be merged by taking the maximum of the stored and incoming observed-volume snapshots. The server SHALL derive the synced `readOnce` counter from its monotonic per-item `everRead` state rather than merging client read counts by last-write-wins or simple maximum. A lower incoming `totalSeen` snapshot SHALL NOT reduce the server value, and a client SHALL adopt higher server values when they are pulled. The server SHALL maintain `totalSeen >= readOnce` for derived-metric safety.

A statistics push response SHALL identify every submitted once-read marker as acknowledged, regardless of whether the marker caused the server's false-to-true transition. A client SHALL retain unacknowledged markers as pending local contributions while adopting the server aggregate.

#### Scenario: Lower offline volume snapshot does not regress history

- **WHEN** the server stores `totalSeen = 100` and a device later pushes `totalSeen = 80`
- **THEN** the server SHALL retain `totalSeen = 100`
- **AND** the device SHALL converge to the retained value on a later pull

#### Scenario: Independent volume increments converge approximately

- **WHEN** two devices independently advance the same counter from 10 to 11 before either sees the other's update
- **THEN** the server SHALL retain a value no lower than 11
- **AND** the system SHALL document that independent increments may be undercounted rather than treated as exact additive group history

#### Scenario: Lifetime read count never follows an unread action downward

- **WHEN** a synced current read flag changes from read to unread
- **THEN** the lifetime `readOnce` aggregate SHALL not decrease

#### Scenario: Exact read count is independent of incomplete volume

- **WHEN** two devices contribute different observed article subsets and the exact server `readOnce` value becomes higher than the submitted `totalSeen` snapshot
- **THEN** the server SHALL raise `totalSeen` to at least `readOnce`
- **AND** the displayed read rate SHALL not exceed 100 percent solely because device observations were incomplete

### Requirement: Server deduplicates synced lifetime reads

For each canonical item identity in a sync group, the server SHALL retain an `everRead` marker that changes from false to true at most once. A current read push or a supported historical-read marker push SHALL set the marker and increase the owning feed's `readOnce` aggregate only when the marker was previously false. The marker transition and aggregate update SHALL be atomic. An unread push SHALL change only the current read state and SHALL never clear the marker or decrement the aggregate. Clients SHALL NOT submit an authoritative `readOnce` value for normal server merging.

#### Scenario: First accepted read increments the group aggregate

- **WHEN** an authenticated sync client pushes `read = 1` for an item whose server `everRead` marker is false
- **THEN** the server SHALL set `everRead` to true
- **AND** the server SHALL increase that feed's `readOnce` aggregate by one

#### Scenario: Duplicate accepted reads do not increment

- **WHEN** one or more clients push `read = 1` for an item whose server `everRead` marker is already true
- **THEN** the server SHALL leave the feed's `readOnce` aggregate unchanged
- **AND** the current read flag SHALL still follow the existing conflict-resolution rules

#### Scenario: Concurrent reads of one item increment once

- **WHEN** two authenticated clients submit a first read for the same canonical item concurrently
- **THEN** the server SHALL set one `everRead` marker
- **AND** the owning feed's `readOnce` aggregate SHALL increase by exactly one

#### Scenario: Unread does not clear lifetime history

- **WHEN** a client pushes `read = 0` for an item whose `everRead` marker is true
- **THEN** the server SHALL update only the current read state
- **AND** SHALL retain `everRead = true`
- **AND** SHALL NOT decrement `readOnce`

#### Scenario: Historical read marker is idempotent

- **WHEN** a device submits a supported `everRead = true` marker for an item that was read before the device joined the sync group
- **THEN** the server SHALL set the marker if it is false and update the feed aggregate once
- **AND** repeating the marker SHALL not increment the feed aggregate again

### Requirement: First-time sync bootstraps statistics

First-time sync SHALL transfer the server's aggregate feed statistics before the newly paired device is considered synchronized. A device with no local statistics SHALL adopt the pulled values, while a device with local statistics SHALL reconcile local and remote values without discarding the higher value.

#### Scenario: Pairing adopts the server feed identity

- **WHEN** a local subscription matches a remote feed by URL but uses a different feed ID
- **THEN** first-time sync SHALL re-key the local feed, item identities, flags, statistics, and once-read markers to the remote `feed_id`
- **AND** the re-key SHALL preserve the local reading state and aggregate values
- **AND** subsequent synchronization writes SHALL use the remote `feed_id` directly

#### Scenario: Empty device receives existing statistics

- **WHEN** a new device performs its first sync for a populated sync group
- **THEN** it SHALL receive the group's aggregate statistics
- **AND** its local statistics SHALL not start at zero for feeds represented by the group
- **AND** the server's `everRead` state SHALL remain the authority for the imported `readOnce` value

#### Scenario: Local history is preserved when joining a group

- **WHEN** a device with local statistics joins a group that already has statistics
- **THEN** the first-time reconciliation SHALL retain the higher local or remote `totalSeen` value
- **AND** it SHALL submit locally retained once-read markers through the supported statistics reconciliation path, independent of the current read value
- **AND** SHALL not replace local history with an empty or lower server snapshot

#### Scenario: Imported statistics are not counted a second time

- **WHEN** a device imports an aggregate `readOnce` value during first-time sync
- **THEN** applying current read flags from the same sync SHALL not increment the local aggregate again
- **AND** the server SHALL not create a second `everRead` contribution for an item already marked true
- **AND** any locally pending marker included in the reconciliation SHALL be acknowledged without creating a second `everRead` contribution

#### Scenario: Historical marker survives an existing server current flag

- **WHEN** a joining device has a once-read marker for an item whose server flag row already exists with `read = 0`
- **THEN** first-time statistics reconciliation SHALL still submit the historical marker
- **AND** the server SHALL retain the item's `everRead = true` state

### Requirement: Normal sync reconciles statistics opportunistically

After first-time setup, the client SHALL include newer local observed-volume snapshots in normal statistics reconciliation and SHALL apply higher remote snapshots received during boot, focus, online, or explicit sync. Read-once changes SHALL be delivered through the server's per-item `everRead` transition when current read flags or historical markers are pushed. Statistics SHALL be allowed to converge without requiring real-time delivery.

#### Scenario: Offline local progress is uploaded later

- **WHEN** a device advances a local counter while offline
- **AND** it later completes a successful sync push
- **THEN** the newer counter value SHALL be offered to the server
- **AND** the server SHALL retain it if it is higher than the stored value

#### Scenario: Remote aggregate is applied without changing current flags

- **WHEN** a pull returns a higher aggregate value for a feed
- **THEN** the client SHALL update its local statistics
- **AND** SHALL leave the current item read/starred flags governed by the existing flag reconciliation rules

#### Scenario: Statistics use an independent cursor

- **WHEN** a client completes an ordinary feed/flag pull without requesting statistics
- **THEN** its statistics cursor SHALL not advance
- **AND** a later statistics-capable client SHALL be able to pull the outstanding aggregate records

#### Scenario: Statistics push accepts only group-device authority

- **WHEN** a client submits an aggregate-volume snapshot or historical-read marker
- **THEN** the server SHALL accept it only from the master sync-key authority
- **AND** an agent token SHALL continue to use the existing read-flag path for current read changes
- **AND** an agent read accepted through that path SHALL still participate in server-side `everRead` deduplication

### Requirement: Statistics survive synced feed cleanup

The server SHALL retain aggregate statistics and `everRead` markers independently of feed tombstones and SHALL NOT delete them solely because a tombstoned feed row reaches its normal cleanup age. Aggregate statistics SHALL remain scoped to the sync key and stable feed identity.

#### Scenario: Feed tombstone cleanup does not erase history

- **WHEN** the server removes an expired feed tombstone
- **THEN** the corresponding retained aggregate statistics and lifetime read markers SHALL remain available to the sync group

### Requirement: Statistics sync is capability-aware

The sync service SHALL advertise aggregate-statistics support through its capabilities response. A client SHALL send statistics only when the server advertises support, and a client SHALL continue operating with local statistics when connected to an older server that does not advertise the capability. Statistics delivery SHALL use an independently persisted cursor so an older client that ignores statistics cannot consume their delivery position.

#### Scenario: Older server does not support statistics

- **WHEN** a sync server reports ordinary sync support but does not report aggregate-statistics support
- **THEN** the client SHALL skip statistics push and pull for that server
- **AND** feed, item-flag, and local statistics behavior SHALL continue without treating the missing capability as a sync failure

#### Scenario: Supported server exposes statistics capability

- **WHEN** a sync server reports aggregate-statistics support
- **THEN** the client SHALL include supported aggregate records in first-time and normal reconciliation
- **AND** the server SHALL return them through an authenticated statistics pull path with its independent cursor

#### Scenario: Existing read writes exact lifetime statistics

- **WHEN** an authenticated principal already authorized to push a current read flag submits `read = 1`
- **THEN** the server SHALL apply the existing current-read conflict rules
- **AND** SHALL apply the atomic `everRead` transition and lifetime aggregate update
- **AND** the principal SHALL not need permission to submit a separate authoritative read counter
