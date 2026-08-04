## MODIFIED Requirements

> **Supersedes** the pre-change scenarios "Remote feed is tombstoned", "Remote feed is tombstoned but local is fresher", and "Re-subscribe clears server-side tombstone" in the `device-sync` capability (add-device-sync spec, lines ~487-507). The tombstone-apply rule is now governed by the local user-mutation timestamp, and tombstone clearing is gated on an explicit `deleted: {value: 0}` subscribe signal rather than on any non-`deleted` write.

### Requirement: Applied remote state updates the local database

When a pull returns remote state, the client SHALL apply it to the local IndexedDB in a way that is consistent with the local data model.

#### Scenario: Remote feed is added
- **WHEN** a pull returns a feed that does not exist locally
- **THEN** the client SHALL upsert it into the local `feeds` store

#### Scenario: Remote feed is tombstoned
- **WHEN** a pull returns a feed with `deleted=1`
- **AND** the local store has the feed
- **AND** the remote `deleted_at` is newer than the local user-mutation time (`modifiedAt`) for that feed
- **THEN** the client SHALL call `unsubscribeFeed(feedId)` to remove the feed and its items
- **AND** SHALL NOT require that the remote row carry a `feed_url` to apply the tombstone

#### Scenario: Remote feed is tombstoned but local is fresher
- **WHEN** a pull returns a feed with `deleted=1`
- **AND** the local user-mutation time (`modifiedAt`) is newer than the remote `deleted_at`
- **THEN** the client SHALL keep the local feed (the user deliberately touched the feed after the remote delete)
- **AND** SHALL NOT call `unsubscribeFeed`
- **AND** SHALL NOT push any field of that feed with a fresh `deleted` stamp (a metadata push SHALL NOT revive the server tombstone)

#### Scenario: Remote feed is tombstoned but local never had it
- **WHEN** a pull returns a feed with `deleted=1`
- **AND** the local store does not have the feed
- **THEN** the client SHALL take no action

#### Scenario: Tombstone applies during first-time setup
- **WHEN** the tombstone-apply rule is evaluated during first-time setup (reconciliation of local state against server state)
- **THEN** the local user-mutation time (`modifiedAt`) SHALL govern the outcome exactly as on any other pull: the tombstone applies if the remote `deleted_at` is newer, and the local feed is kept if `modifiedAt` is newer

#### Scenario: Remote flag is applied
- **WHEN** a pull returns a flag for an item that exists locally
- **THEN** the client SHALL update the item's `read` and `starred` fields in the `items` store
- **AND** SHALL update the `itemFlags` store

#### Scenario: Remote flag for an unknown item
- **WHEN** a pull returns a flag for an item that does not exist locally yet
- **THEN** the client SHALL store the flag in the `itemFlags` store
- **AND** SHALL apply the read/starred values to the item when it later appears (e.g., after a feed refresh)

#### Scenario: New item creation preserves stored sync flags
- **WHEN** a feed refresh creates a new item via `bulkUpsertItems` or `insertOrUpdateItem`
- **THEN** the new-item creation path SHALL consult any existing `itemFlags` row for that item
- **AND** SHALL use the stored `read` and `starred` values from the `itemFlags` row when constructing the new item
- **AND** SHALL NOT overwrite a stored flag with the new item's default (`read: false, starred: false`)
- **AND** if no `itemFlags` row exists, SHALL use the values from the new item as before

#### Scenario: Item-ID encoding round-trip
- **WHEN** the client constructs an `item_id` for the server
- **THEN** it SHALL be `encodeURIComponent(feedUrl) + '::' + guid`
- **AND** the server SHALL store and return it as a single string
- **WHEN** the client parses a returned `item_id`
- **THEN** it SHALL split at the *last* `::` occurrence and `decodeURIComponent` the prefix to recover the feed URL

### Requirement: Push protocol with PATCH semantics

The system SHALL provide a `POST /sync/push` endpoint that accepts a batch of local changes with PATCH semantics: each field in the payload is updated on the server only if its per-field timestamp is newer than the server's existing value, or if the existing field has no timestamp.

#### Scenario: Successful push
- **WHEN** a client posts a push payload containing feeds and flags
- **THEN** the server SHALL update each row's fields whose payload timestamp is newer than the existing field's timestamp
- **AND** SHALL leave unchanged fields whose payload timestamp is older
- **AND** SHALL stamp `row_at` with `max(field_at)` for the row
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

### Requirement: Tombstone GC

Tombstoned feed rows (`deleted=1`) SHALL be removed by a scheduled server-side task after 30 days.

#### Scenario: Scheduled tombstone cleanup
- **WHEN** a daily cron trigger runs
- **THEN** the server SHALL delete rows from `feeds` where `deleted=1 AND deleted_at < now - 30 days`
- **AND** SHALL delete rows from `rate_limits` older than the largest window

#### Scenario: Re-subscribe during tombstone window
- **WHEN** a device pushes a feed payload with `deleted: { value: 0 }` and a `feedUrl` for a URL whose server row is tombstoned
- **THEN** the server SHALL revive the tombstoned row (clear the tombstone and update the subscription)
- **AND** SHALL NOT treat the push as an error

#### Scenario: Metadata push during tombstone window
- **WHEN** a device pushes a feed payload without the `deleted` field for a URL whose server row is tombstoned
- **THEN** the server SHALL leave the tombstone in place
- **AND** SHALL NOT treat the push as an error

## ADDED Requirements

### Requirement: Feed user-mutation timestamp

The local `Feed` record SHALL track a `modifiedAt` field (epoch ms) representing the last user-initiated mutation of that feed on this device. Background feed fetching SHALL NOT update it. This field is local-only and SHALL NOT be transmitted in sync payloads.

#### Scenario: Subscribe sets the timestamp
- **WHEN** the user subscribes to a feed
- **THEN** the local feed record SHALL be created with `modifiedAt` set to the subscribe time

#### Scenario: Metadata edits bump the timestamp
- **WHEN** the user edits the feed title, tags, or URL
- **THEN** the local feed record SHALL have `modifiedAt` updated to the edit time

#### Scenario: Background fetch does not bump the timestamp
- **WHEN** the background scheduler fetches a feed (success, 304 not-modified, or error)
- **THEN** the local feed record's `modifiedAt` SHALL remain unchanged

#### Scenario: Pull merge preserves the timestamp
- **WHEN** a pull applies remote state to a feed that exists locally
- **THEN** the merged local record SHALL preserve the local `modifiedAt`
- **AND** SHALL NOT adopt the remote row's `row_at` or `deleted_at` as `modifiedAt`

#### Scenario: Legacy records fall back to per-field timestamps
- **WHEN** a feed record predates the `modifiedAt` field (no value stored)
- **THEN** the tombstone-apply rule SHALL use `max(urlAt, titleAt, tagsAt)` as the user-mutation time
- **AND** a record with no user touches at all SHALL be treated as user-mutation time 0, so the tombstone applies

### Requirement: Deleted-stamp discipline on client pushes

The client SHALL include the `deleted` field in a feed push payload only for explicit subscription-state events: subscribe/re-subscribe (`deleted: 0`) and unsubscribe (`deleted: 1`). Metadata-only feed pushes (title, tags, URL) SHALL NOT include the `deleted` field.

#### Scenario: Subscribe stamps deleted 0
- **WHEN** the user subscribes to a feed and the dirty entry is pushed
- **THEN** the push payload SHALL include `deleted: { value: 0, at: <subscribe time> }`

#### Scenario: Unsubscribe stamps deleted 1 and the feed URL
- **WHEN** the user unsubscribes from a feed and the dirty entry is pushed
- **THEN** the push payload SHALL include `deleted: { value: 1, at: <unsubscribe time> }`
- **AND** SHALL include `feedUrl` (the feed's URL at delete time, stamped with the delete time)

#### Scenario: Metadata edit omits deleted
- **WHEN** the user edits a feed's title, tags, or URL and the dirty entry is pushed
- **THEN** the push payload SHALL NOT include the `deleted` field

#### Scenario: Delete coalesces pending upserts for the same feed
- **WHEN** the user unsubscribes from a feed that has pending (unpushed) metadata edits queued
- **THEN** the queued metadata entries for that feed SHALL be dropped when the delete is enqueued
- **AND** the pushed delete SHALL be the only feed entry for that feed
