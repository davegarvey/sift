## MODIFIED Requirements

### Requirement: Push protocol with PATCH semantics

The system SHALL provide a `POST /sync/push` endpoint that accepts a batch of local changes with PATCH semantics. Payloads SHALL NOT carry client-supplied timestamps: every field value is stamped by the server with the batch's monotonic time, so the server is the only clock in the system. A payload containing per-field `at` wrappers (the legacy `{ value, at }` shape) SHALL be rejected with HTTP 400. `row_at` SHALL be stamped with the same server batch time as the field stamps, so rows are delivered in arrival order and exactly once per batch that touched them. Because all stamps in a batch are equal, the `deleted` field SHALL use a tie-break rule: a tombstone (`deleted: 1`) SHALL win against an equal stamp, so an in-batch subscribe followed by a delete leaves no live row. Note: several scenarios below retain their legacy names (required by the archive workflow) but their content describes the new bare-value contract.

#### Scenario: Successful push
- **WHEN** a client posts a push payload containing feeds and flags with bare field values (no `at` wrapper)
- **THEN** the server SHALL stamp every pushed field with the server's monotonic batch time
- **AND** SHALL update the rows, replacing existing values (a server-stamped write is always newer than any previously stored stamp, except a tie within the same batch)
- **AND** SHALL stamp `row_at` with the same batch time (the same value for every row in the batch, including rows touched by the URL-scoped delete rule)
- **AND** SHALL respond with HTTP 204

#### Scenario: New row inserted
- **WHEN** a client pushes a feed or flag whose `sync_key + feed_url` (or `sync_key + item_id`) does not exist on the server
- **THEN** the server SHALL insert the row with the pushed fields, stamped with the batch time
- **AND** any fields not in the payload SHALL be NULL

#### Scenario: Concurrent change on a different field
- **WHEN** device A pushes `{ read: 0 }` for an item whose server row has `{ read: 1, starred: 1 }`
- **THEN** the server SHALL update only the `read` field
- **AND** SHALL preserve the `starred` field (not in the payload, so the server does not touch it)

#### Scenario: Equal timestamps keep the existing value
- **WHEN** a push batch contains two entries for the same field of the same row (e.g. two entries for one feed's `title`)
- **THEN** the server SHALL keep the first entry's value (both entries carry the same batch stamp, and ties keep the existing value)
- **EXCEPT** the `deleted` field, where a tombstone (`deleted: 1`) SHALL win ties (see "Same-batch subscribe then delete leaves no live row")
- **AND** the client SHALL deduplicate its dirty set before pushing, so in-batch duplicates are the exception, not the rule

#### Scenario: Push payload validation
- **WHEN** a client posts a malformed payload (missing required fields, wrong types, mismatched `feed_id` for a flag's `item_id`)
- **THEN** the server SHALL respond with HTTP 400 with a descriptive error naming the field
- **AND** SHALL NOT include the user-supplied value in the error body

#### Scenario: Push with at=0 against an existing field
- **WHEN** a client posts a payload using the legacy `{ value, at }` shape with `at=0` for an existing field
- **THEN** the server SHALL reject the payload with HTTP 400 (timestamps are no longer part of the protocol)
- **AND** SHALL NOT update the field

#### Scenario: Push with at=0 against a new row
- **WHEN** a client posts a payload using the legacy `{ value, at }` shape with `at=0` for a row that does not exist
- **THEN** the server SHALL reject the payload with HTTP 400
- **AND** SHALL NOT insert the row

#### Scenario: Server derives feed_url from item_id
- **WHEN** a client pushes a flag with `itemId` and `feedId`
- **THEN** the server SHALL derive the feed ID from `itemId` by splitting at the last `::` and `decodeURIComponent`ing the prefix
- **AND** SHALL reject the push with HTTP 400 if the derived value does not match the client-supplied `feedId`

#### Scenario: Metadata-only push does not clear a tombstone
- **WHEN** a client pushes a feed payload without the `deleted` field (e.g., only `title`, `tags`, or `feedUrl`) for a row whose server-side `deleted=1`
- **THEN** the server SHALL NOT clear the tombstone
- **AND** SHALL apply only the pushed fields to the tombstoned row

#### Scenario: Delete tombstones every row sharing the feed URL
- **WHEN** a client pushes `{ deleted: 1 }` for a feed
- **THEN** the server SHALL tombstone the targeted row
- **AND** SHALL apply the same delete stamp to every other row with the same `feed_url` under the sync key
- **AND** SHALL NOT run the tombstone-clear step for a `deleted: 1` push (a newer tombstone SHALL NOT be regressed by an older delete stamp)
- **AND** SHALL NOT treat the push as an error when the URL matches multiple rows
- **AND** when the payload omits `feedUrl`, the server SHALL resolve the URL from the stored row for the URL-scoped rule

#### Scenario: Delete after a remote rename tombstones rows under the winning URL
- **WHEN** a client pushes `{ deleted: 1 }` for a feed whose URL was renamed by an earlier push on another device
- **THEN** the server SHALL tombstone every other row sharing the payload URL (the payload URL's stamp is the newest, so it is the URL the per-field PATCH leaves on the targeted row)

#### Scenario: Delete of a feed unknown to the server still tombstones URL siblings
- **WHEN** a client pushes `{ deleted: 1 }` with a `feedUrl` for a `feed_id` that has no server row (e.g., subscribe-then-delete churn coalesced before the first push)
- **THEN** the server SHALL create the tombstoned row
- **AND** SHALL tombstone every other row sharing that URL (per the URL-scoped delete rule)
- **AND** SHALL NOT deliver the feed back to the deleting device on the next pull

#### Scenario: Subscribe revives a tombstoned row by URL
- **WHEN** a client pushes a feed payload with `{ deleted: 0 }` and a `feedUrl`
- **AND** a tombstoned row (`deleted=1`) exists under that URL for the sync key
- **THEN** the server SHALL revive the oldest tombstoned row under its existing `feed_id` (clear the tombstone and apply the pushed fields) instead of inserting a new row
- **AND** SHALL accept the payload with HTTP 2xx

#### Scenario: Same-batch delete then subscribe revives the in-batch tombstone
- **WHEN** a push batch tombstones a feed URL (`{ deleted: 1 }`) and a later entry in the same batch subscribes to the same URL (`{ deleted: 0 }` + `feedUrl`)
- **THEN** the subscribe SHALL revive the row tombstoned earlier in the same batch under its existing `feed_id`
- **AND** SHALL NOT insert a second row for the URL

#### Scenario: Same-batch subscribe then delete leaves no live row
- **WHEN** a push batch subscribes to a URL (`{ deleted: 0 }` + `feedUrl`) and a later entry in the same batch tombstones a feed with that URL (`{ deleted: 1 }`)
- **THEN** the delete SHALL win the tie on the `deleted` field (tombstone tie-break)
- **AND** the URL-scoped delete rule SHALL also tombstone the row the subscribe created
- **AND** after the batch, SHALL NOT leave any live row for the URL

#### Scenario: Legacy client payloads remain valid
- **WHEN** a client posts a payload using the legacy `{ value, at }` shape
- **THEN** the server SHALL reject the payload with HTTP 400 (legacy timestamped payloads are not supported; all clients must use bare field values)

### Requirement: Deleted-stamp discipline on client pushes

The client SHALL include the `deleted` field in a feed push payload only for explicit subscription-state events: subscribe/re-subscribe (`deleted: 0`) and unsubscribe (`deleted: 1`). Metadata-only feed pushes (title, tags, URL) SHALL NOT include the `deleted` field. Push payloads SHALL use bare field values; no timestamps are attached.

#### Scenario: Subscribe stamps deleted 0
- **WHEN** the user subscribes to a feed and the dirty entry is pushed
- **THEN** the push payload SHALL include `deleted: 0`

#### Scenario: Unsubscribe stamps deleted 1 and the feed URL
- **WHEN** the user unsubscribes from a feed and the dirty entry is pushed
- **THEN** the push payload SHALL include `deleted: 1`
- **AND** SHALL include `feedUrl` (the feed's URL at delete time)

#### Scenario: Metadata edit omits deleted
- **WHEN** the user edits a feed's title, tags, or URL and the dirty entry is pushed
- **THEN** the push payload SHALL NOT include the `deleted` field

#### Scenario: Delete coalesces pending upserts for the same feed
- **WHEN** the user unsubscribes from a feed that has pending (unpushed) metadata edits queued
- **THEN** the queued metadata entries for that feed SHALL be dropped when the delete is enqueued
- **AND** the pushed delete SHALL be the only feed entry for that feed

### Requirement: Client server-clock offset normalization

The client SHALL maintain a server-clock offset, measured on every successful pull as `serverTime - Date.now()` at response receipt, and SHALL apply it to incoming remote stamps before comparison with local values (local merge timestamps are in the local frame). Outgoing push payloads SHALL NOT contain timestamps, so no outgoing conversion exists. The offset SHALL be cleared when sync is disabled.

#### Scenario: Offset is measured on every successful pull
- **WHEN** a pull response is received (including one with an empty feeds/flags payload)
- **THEN** the client SHALL store `offset = serverTime - Date.now()` for that response
- **AND** SHALL apply that offset to the incoming stamps of the same pull (the first pull is not exempt)

#### Scenario: Outgoing stamps are server-frame
- **WHEN** the client builds a push payload from queued changes
- **THEN** the payload SHALL NOT contain any timestamps or offset-adjusted values
- **AND** the stored offset SHALL NOT be applied to anything outgoing

#### Scenario: Incoming stamps are local-frame
- **WHEN** the client applies a pull response to a local feed or flag
- **THEN** every remote numeric stamp (feed per-field timestamps, `deleted_at`, `row_at`) SHALL be converted to the local frame (stamp minus offset) before comparison with local values
- **AND** per-field timestamps stored on merged records SHALL be local-frame

#### Scenario: Offset is cleared with sync state
- **WHEN** the user disables sync (or regenerates the key)
- **THEN** the stored offset SHALL be cleared along with `lastSyncAt` and the dirty set
