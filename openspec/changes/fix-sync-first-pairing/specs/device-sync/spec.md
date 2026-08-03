## MODIFIED Requirements

### Requirement: First-time setup ordering

**MODIFIED** — first-time setup must be non-destructive: when a user enables sync or pairs a device that already has local state, the system SHALL perform an initial sync that preserves existing group state while incorporating the device's local-only data. The client SHALL pull all server state (`since=0`) first, then push only the local feeds and flags that do not already exist on the server, then apply the pulled server state locally. This applies to every first-time setup, including re-enable with a fresh key, regardless of any previously stored `lastSyncAt`.

#### Scenario: First-time enable on a device with local data
- **WHEN** the user enables sync for the first time
- **AND** the device has N local feeds and M local flags
- **AND** the server has P feeds and Q flags for the same sync key
- **THEN** the client SHALL pull all server state (`since=0`)
- **AND** SHALL push only the local feeds whose `feed_id` and URL both do not match any server feed
- **AND** SHALL push only the local flags whose raw item ID does not match any server flag (server `item_id` SHALL be normalized with `decodeItemId` before comparison)
- **AND** SHALL apply the pulled server state to the local IndexedDB
- **AND** SHALL update `lastSyncAt` to the returned `serverTime`

#### Scenario: Local feed already deleted on the server
- **WHEN** the device has a local feed whose URL or `feed_id` exists on the server with `deleted=1`
- **THEN** the client SHALL NOT push that feed
- **AND** SHALL apply the tombstone locally, removing the feed and its items

#### Scenario: Local feed whose URL changed on the server after deletion
- **WHEN** the device has a local feed whose `feed_id` exists on the server as a tombstone carrying a different URL (e.g., the feed was renamed on the other device and then deleted)
- **THEN** the client SHALL NOT push that feed
- **AND** SHALL apply the tombstone locally, removing the feed and its items
- **AND** the tombstone SHALL remain on the server

#### Scenario: Stale local tags do not overwrite newer group tags
- **WHEN** the device has a local feed that exists on the server (by `feed_id` or URL) with newer server-side tags
- **THEN** the client SHALL NOT push the local tags
- **AND** the local feed SHALL adopt the server's tags after the merge

#### Scenario: Empty local + populated server
- **WHEN** the device has no local data
- **AND** the server has feeds and flags
- **THEN** after the first-time merge, the local state SHALL match the server state

#### Scenario: Populated local + empty server (wiped-server recovery)
- **WHEN** the device has local feeds and flags
- **AND** the server has no data for the sync key
- **THEN** all local feeds and flags SHALL diff as new
- **AND** after the first-time merge, the server SHALL contain the local state
- **AND** the local state SHALL be unchanged

#### Scenario: Re-enable with a fresh key starts clean
- **WHEN** the user disables sync and re-enables it with a new sync key
- **THEN** the client SHALL clear `lastSyncAt` and the dirty set at disable time
- **AND** the first-time setup SHALL run the full reconciliation (pull `since=0` + diff) against the new key
- **AND** flags or feeds accumulated locally while sync was disabled SHALL NOT be pushed to the previous group or assumed pushed

#### Scenario: Existing row values are not re-stamped (no synthetic timestamps)
- **WHEN** a local feed exists on the server and is skipped by the diff
- **THEN** the client SHALL NOT push any field of that feed with a fresh timestamp
- **AND** per-field reconciliation SHALL compare the device's existing local timestamps against the server's

#### Scenario: Local newer wins (per field, server does not converge)
- **WHEN** the local row has a field with a real local timestamp (tags, title, url) that is newer than the server's
- **THEN** after the first-time merge, the local value for that field SHALL be preserved locally
- **AND** the server value SHALL NOT be modified by the first-time setup

#### Scenario: Server newer wins
- **WHEN** the server row has a field whose timestamp is newer than the local's
- **THEN** after the first-time merge, the local store SHALL have the server value for that field
- **AND** the server value SHALL be preserved
