## MODIFIED Requirements

### Requirement: Monotonic server time

All server-side timestamps SHALL come from a monotonic wall clock in the `counters` table: epoch-millisecond anchored, strictly increasing, and never regressing below the wall clock or the previous value. The value SHALL be updated atomically on every server-side timestamp assignment.

#### Scenario: Timestamps are monotonic across the server
- **WHEN** the server assigns a timestamp to row R1 at operation N
- **AND** later assigns a timestamp to row R2 at operation N+10
- **THEN** R2's timestamp SHALL be greater than R1's timestamp
- **AND** this SHALL hold even if the wall clock regresses between the two operations

#### Scenario: Server time tracks the wall clock
- **WHEN** the server has not assigned a timestamp for a long period
- **AND** a pull requests the current server time
- **THEN** the reported `serverTime` SHALL be within the same epoch-millisecond scale as `Date.now()` (never a free-running counter far from the wall)

#### Scenario: Clock regression does not break the pull model
- **WHEN** the wall clock jumps backward by 5 minutes
- **AND** the server assigns new timestamps via the monotonic clock
- **THEN** rows stamped after the jump SHALL still be returned by a pull with `since=<pre_jump_value>`
- **AND** the pull response SHALL include the server time as `serverTime`

#### Scenario: Pull response includes serverTime
- **WHEN** a client calls `GET /sync/pull`
- **THEN** the response SHALL include a `serverTime` field whose value is the current server time
- **AND** the client SHALL use `max(currentLastSyncAt, serverTime)` as the new `lastSyncAt`
- **AND** because `serverTime` is epoch-scaled, a pull with `since` from a pre-change client (a small counter value) SHALL still return all rows whose `row_at` is epoch-scaled, so pre-change cursors converge in one cycle

### Requirement: Push protocol with PATCH semantics

The system SHALL provide a `POST /sync/push` endpoint that accepts a batch of local changes with PATCH semantics: each field in the payload is updated on the server only if its per-field timestamp is newer than the server's existing value, or if the existing field has no timestamp. `row_at` SHALL be stamped with the server's monotonic batch time, so rows are delivered in arrival order and exactly once per batch that touched them.

#### Scenario: Successful push
- **WHEN** a client posts a push payload containing feeds and flags
- **THEN** the server SHALL update each row's fields whose payload timestamp is newer than the existing field's timestamp
- **AND** SHALL leave unchanged fields whose payload timestamp is older
- **AND** SHALL stamp `row_at` with the server batch time (the same value for every row in the batch, including rows touched by the URL-scoped delete rule), unless the row's `row_at` is already newer
- **AND** SHALL respond with HTTP 204

#### Scenario: New row inserted
- **WHEN** a client pushes a feed or flag whose `sync_key + feed_url` (or `sync_key + item_id`) does not exist on the server
- **THEN** the server SHALL insert the row with the pushed fields and timestamps
- **AND** any fields not in the payload SHALL be NULL with NULL timestamps

#### Scenario: Concurrent change on a different field
- **WHEN** device A pushes `{ read: { value: 0, at: T3 } }` for an item whose server row has `{ read_at: T1, starred_at: T2, starred: 1 }`
- **THEN** the server SHALL update only the `read` field (since T3 > T1)
- **AND** SHALL preserve the `starred` field and its timestamp (T2 is not in the payload, so the server does not touch it)

#### Scenario: Equal timestamps keep the existing value
- **WHEN** a client pushes a field whose `at` equals the existing field's `at`
- **THEN** the server SHALL keep the existing value (first-writer wins on ties)
- **AND** SHALL NOT update the field's timestamp

#### Scenario: Push payload validation
- **WHEN** a client posts a malformed payload (missing required fields, wrong types, timestamps not numeric, mismatched `feed_url` for a flag's `item_id`)
- **THEN** the server SHALL respond with HTTP 400 with a descriptive error naming the field
- **AND** SHALL NOT include the user-supplied value in the error body

#### Scenario: Push with at=0 against an existing field
- **WHEN** a client pushes a field with `at=0`
- **AND** the server's existing field has `field_at > 0`
- **THEN** the server SHALL accept the push (return 2xx) but SHALL NOT update the field (the strict `>` comparison keeps the existing value)

#### Scenario: Push with at=0 against a new row
- **WHEN** a client pushes a field with `at=0` to a row that does not exist
- **THEN** the server SHALL insert the row with `at=0` for that field (the NULL-or-`>` comparison accepts the value when the existing field is NULL)

#### Scenario: Server derives feed_url from item_id
- **WHEN** a client pushes a flag with `itemId` and `feedUrl`
- **THEN** the server SHALL derive `feedUrl` from `itemId` by splitting at the last `::` and `decodeURIComponent`ing the prefix
- **AND** SHALL reject the push with HTTP 400 if the derived value does not match the client-supplied `feedUrl`

#### Scenario: Metadata-only push does not clear a tombstone
- **WHEN** a client pushes a feed payload without the `deleted` field (e.g., only `title`, `tags`, or `feedUrl`) for a row whose server-side `deleted=1`
- **THEN** the server SHALL NOT clear the tombstone
- **AND** SHALL apply only the pushed fields to the tombstoned row

#### Scenario: Delete tombstones every row sharing the feed URL
- **WHEN** a client pushes `deleted: { value: 1 }` for a feed
- **THEN** the server SHALL tombstone the targeted row
- **AND** SHALL apply the same `deleted` stamp to every other row with the same `feed_url` under the sync key, subject to per-row LWW (a row whose own `deleted_at` is newer SHALL keep its value)
- **AND** SHALL NOT run the tombstone-clear step for a `deleted: { value: 1 }` push (a newer tombstone's `deleted_at` SHALL NOT be regressed by an older delete stamp)
- **AND** SHALL NOT treat the push as an error when the URL matches multiple rows
- **AND** when the payload omits `feedUrl`, the server SHALL resolve the URL from the stored row for the URL-scoped rule

#### Scenario: Delete after a remote rename tombstones rows under the winning URL
- **WHEN** a client pushes `deleted: { value: 1 }` for a feed whose URL was renamed on another device (per-field LWW decides the row's URL between the payload URL and the stored URL)
- **THEN** the server SHALL tombstone every other row sharing the LWW-winning URL (the same URL the per-field PATCH leaves on the targeted row)

#### Scenario: Delete of a feed unknown to the server still tombstones URL siblings
- **WHEN** a client pushes `deleted: { value: 1 }` with a `feedUrl` for a `feed_id` that has no server row (e.g., subscribe-then-delete churn coalesced before the first push)
- **THEN** the server SHALL create the tombstoned row
- **AND** SHALL tombstone every other row sharing that URL (per the URL-scoped delete rule)
- **AND** SHALL NOT deliver the feed back to the deleting device on the next pull

#### Scenario: Subscribe revives a tombstoned row by URL
- **WHEN** a client pushes a feed payload with `deleted: { value: 0 }` and a `feedUrl`
- **AND** a tombstoned row (`deleted=1`) exists under that URL for the sync key
- **THEN** the server SHALL revive the oldest tombstoned row under its existing `feed_id` (clear the tombstone and apply the pushed fields) instead of inserting a new row
- **AND** SHALL accept the payload with HTTP 2xx

#### Scenario: Same-batch delete then subscribe revives the in-batch tombstone
- **WHEN** a push batch tombstones a feed URL (`deleted: { value: 1 }`) and a later entry in the same batch subscribes to the same URL (`deleted: { value: 0 }` + `feedUrl`)
- **THEN** the subscribe SHALL revive the row tombstoned earlier in the same batch under its existing `feed_id`
- **AND** SHALL NOT insert a second row for the URL

#### Scenario: Same-batch subscribe then delete leaves no live row
- **WHEN** a push batch subscribes to a URL (`deleted: { value: 0 }` + `feedUrl`) and a later entry in the same batch tombstones a feed with that URL (`deleted: { value: 1 }`)
- **THEN** the delete SHALL also tombstone the row the subscribe created (per the URL-scoped delete rule)
- **AND** after the batch, SHALL NOT leave any live row for the URL

#### Scenario: Legacy client payloads remain valid
- **WHEN** an older client pushes a feed payload that includes `deleted: { value: 0 }` together with metadata fields
- **THEN** the server SHALL accept the payload (HTTP 2xx) and apply the pushed fields
- **AND** tombstone clearing SHALL follow the `deleted`-field rule as for any payload (an older client can therefore clear a tombstone; this stale-client window is documented)

### Requirement: Pull protocol

The system SHALL provide a `GET /sync/pull?since=<epoch_ms>` endpoint that returns all feeds and flags whose `row_at >= since`, plus the server's current time. The inclusive comparison ensures a row stamped in the same millisecond as the reported `serverTime` is delivered on the next pull (the cursor strictly advances, so delivery remains exactly-once).

#### Scenario: Pull returns only newer rows
- **WHEN** a client requests a pull with `since=<t>`
- **THEN** the server SHALL return only feeds and flags with `row_at >= t`
- **AND** SHALL include a `serverTime` field in the response

#### Scenario: Initial pull on a paired device
- **WHEN** a freshly paired device requests a pull with `since=0`
- **THEN** the server SHALL return all feeds and flags for the user

#### Scenario: Pull with missing or null `since`
- **WHEN** a client requests a pull with `since` missing, null, or empty
- **THEN** the server SHALL treat it as `since=0` and return all server state for the key

#### Scenario: Row stamped at the cursor value is delivered on the next pull
- **WHEN** a row's `row_at` equals the `since` value of a pull (a push and a pull landed in the same millisecond)
- **THEN** the pull SHALL return the row (inclusive comparison)
- **AND** the device's next pull SHALL NOT return it again (the cursor advances past it)

### Requirement: Per-user row cap

The server SHALL enforce per-user row caps on feeds and flags. Pushes that would exceed the cap SHALL be rejected with HTTP 413. Tombstoned feed rows (`deleted=1`) SHALL NOT count toward the feed cap — they are transient (30-day GC) and must not crowd out live subscriptions.

#### Scenario: Push within cap
- **WHEN** a client pushes a payload that would not exceed 10,000 live feeds or 1,000,000 flags for the user
- **THEN** the server SHALL accept the push

#### Scenario: Push exceeds cap
- **WHEN** a client pushes a payload that would exceed the cap
- **THEN** the server SHALL respond with HTTP 413
- **AND** the client SHALL surface the error in the Settings UI ("Sync storage limit reached")
- **AND** SHALL stop pushing until the user regenerates the key

#### Scenario: Tombstones do not count toward the feed cap
- **WHEN** the user has churned through many subscribe/delete cycles, leaving tombstoned rows
- **THEN** the feed cap SHALL be computed over `deleted = 0` rows only
- **AND** a push of new live feeds SHALL NOT be rejected because of tombstone count

## ADDED Requirements

### Requirement: Client server-clock offset normalization

The client SHALL maintain a server-clock offset, measured on every successful pull as `serverTime - Date.now()` at response receipt, and SHALL apply it to the same pull's incoming stamps. Outgoing wire stamps are the local time plus the offset (server frame); incoming remote stamps are converted back to the local frame before comparison or storage. The offset SHALL be cleared when sync is disabled.

#### Scenario: Offset is measured on every successful pull
- **WHEN** a pull response is received (including one with an empty feeds/flags payload)
- **THEN** the client SHALL store `offset = serverTime - Date.now()` for that response
- **AND** SHALL apply that offset to the incoming stamps of the same pull (the first pull is not exempt)

#### Scenario: Outgoing stamps are server-frame
- **WHEN** the client builds a push payload from queued changes
- **THEN** every field `at` (feed fields, the delete stamp, and flag fields) SHALL be the queued local-frame stamp plus the stored offset
- **AND** if no offset is stored yet (no pull has succeeded), SHALL use the local-frame stamp unchanged

#### Scenario: Incoming stamps are local-frame
- **WHEN** the client applies a pull response to a local feed or flag
- **THEN** every remote numeric stamp (feed per-field timestamps, `deleted_at`, `row_at`) SHALL be converted to the local frame (stamp minus offset) before comparison with local values
- **AND** per-field timestamps stored on merged records SHALL be local-frame

#### Scenario: Offset is cleared with sync state
- **WHEN** the user disables sync (or regenerates the key)
- **THEN** the stored offset SHALL be cleared along with `lastSyncAt` and the dirty set
