## ADDED Requirements

### Requirement: Sync key generation and storage

When the user enables device sync, the system SHALL generate a 128-bit cryptographically random sync key, encode it as URL-safe base64 (22 characters), and persist it in the browser's IndexedDB. The sync key SHALL be the user's identity for sync purposes; no account, email, or password is required.

#### Scenario: User enables sync for the first time
- **WHEN** the user toggles "Sync" on in Settings and no sync key is currently stored
- **THEN** the system SHALL generate 16 random bytes via `crypto.getRandomValues`
- **AND** SHALL encode the result as base64url
- **AND** SHALL store the encoded string in the IndexedDB meta store under the sync settings key
- **AND** SHALL open the pairing modal

#### Scenario: Sync key persists across app restarts
- **WHEN** the user closes and reopens the app
- **THEN** the previously generated sync key SHALL be available from IndexedDB
- **AND** no new key SHALL be generated

#### Scenario: User regenerates the sync key
- **WHEN** the user clicks "Regenerate" and confirms the dialog
- **THEN** a new 128-bit sync key SHALL be generated
- **AND** the previous key SHALL be replaced in IndexedDB
- **AND** the previous key's data on the server SHALL be orphaned (no migration is performed)

### Requirement: Sync key format validation

The sync key SHALL be exactly 22 base64url characters (A–Z, a–z, 0–9, `-`, `_`). The server SHALL validate this format before consulting the database.

#### Scenario: Client sends a well-formed key
- **WHEN** a request includes an `X-Sync-Key` header that is exactly 22 base64url characters
- **THEN** the server SHALL proceed with the database lookup

#### Scenario: Client sends a malformed key
- **WHEN** a request includes an `X-Sync-Key` header that is not exactly 22 base64url characters
- **THEN** the server SHALL respond with HTTP 401 without consulting the database
- **AND** the server SHALL NOT log the malformed value

### Requirement: Unified pairing modal

The system SHALL provide a single pairing modal that exposes all three pairing flows: QR code, 8-character server-generated OTP code, and direct paste of the sync key. The system SHALL NOT detect the device type or conditionally hide any flow; the user picks the flow that fits their situation.

#### Scenario: Source device shows all three flows
- **WHEN** a user with sync enabled opens the pairing modal
- **THEN** the modal SHALL display a QR code, an 8-character server-generated OTP code (with a button to issue / re-issue), and the sync key as a copyable string
- **AND** SHALL include an input field where a target device can paste a code or sync key

#### Scenario: Target device (no existing key) opens the modal
- **WHEN** a user without a stored sync key opens the pairing modal
- **THEN** the modal SHALL display the input field for pasting a code or sync key prominently
- **AND** SHALL include a "Generate a new sync key" affordance for users starting from scratch

#### Scenario: Modal layout on wide and narrow screens
- **WHEN** the modal is rendered on a wide screen
- **THEN** the QR code SHALL be the dominant element on one side
- **AND** the OTP / paste UI SHALL be on the other side
- **WHEN** the modal is rendered on a narrow screen
- **THEN** the elements SHALL stack vertically with the QR code on top

### Requirement: Pairing code entropy is sufficient

The pairing code SHALL provide sufficient entropy that brute-forcing it within the 5-minute TTL is computationally infeasible given the per-IP rate limit.

#### Scenario: Code space is large
- **WHEN** the server generates a pairing code
- **THEN** the code SHALL be 8 characters drawn from an alphabet of 31 unambiguous characters
- **AND** the total code space SHALL be 31⁸ ≈ 8.5 × 10¹¹ combinations
- **AND** SHALL NOT use ambiguous characters (`0`, `1`, `l`, `i`, `o`)

#### Scenario: Brute force is infeasible
- **WHEN** an attacker tries to brute-force a valid code
- **THEN** the per-IP rate limit (10 per minute) bounds the attacker to at most 50 attempts per code lifetime
- **AND** the 8.5 × 10¹¹ / 50 ≈ 1.7 × 10¹⁰ distinct IPs required is computationally infeasible for a personal RSS reader

### Requirement: Pairing via QR code (deferred scanning in v1)

The system SHALL render a QR code for the sync key in the pairing modal, using a vetted library with error correction level M. In v1, no camera-based scanning is implemented; the QR is rendered for visual reference and forward compatibility with v2 scanning.

#### Scenario: QR code renders for current sync key
- **WHEN** sync is enabled and the pairing modal is open on a source device
- **THEN** the modal SHALL display a QR code that encodes the current sync key
- **AND** the QR code SHALL use error correction level M
- **AND** the modal SHALL display a note that camera scanning is not yet implemented and the user should use the pairing code or sync-key paste flow
- **AND** a test SHALL decode the QR with a known-good library (`jsQR`) and assert the decoded string equals the sync key

### Requirement: Pairing via server-generated OTP code

When a source device issues a pairing code, the server SHALL generate a unique 8-character code (lowercase alphanumeric, no ambiguous characters), store it with a 5-minute TTL, return it to the source, and allow a target device to redeem the code to receive the sync key.

#### Scenario: Source issues a code
- **WHEN** the user clicks "Issue pairing code" on a source device
- **THEN** the client SHALL call `POST /sync/otp` (no body)
- **AND** SHALL display the returned code in the modal with a 5-minute countdown
- **AND** the server SHALL generate the code from the alphabet `[a-hj-km-np-z2-9]` (31 unambiguous characters; excludes `0`, `1`, `i`, `l`, `o`)
- **AND** SHALL store `(code, sync_key, expires_at)` in the `pairing_codes` table

#### Scenario: Code is unique
- **WHEN** the server generates a pairing code
- **THEN** the server SHALL guarantee the code is not already present in the `pairing_codes` table
- **AND** on the (astronomically unlikely) event of a collision, SHALL retry the generation
- **AND** SHALL bound the retries (max 5 attempts) and return 500 if all attempts collide

#### Scenario: Source shows "waiting for pair" state
- **WHEN** a code has been issued and the target has not yet redeemed
- **THEN** the source modal SHALL display a "Waiting for another device to pair…" state with the countdown
- **AND** the source SHALL detect successful pairing when its next pull returns data from the new device (e.g., the target's existing flags)

#### Scenario: Target redeems a valid code
- **WHEN** the user pastes an 8-character code on a target device and clicks "Pair"
- **THEN** the client SHALL call `POST /sync/redeem { code }`
- **AND** on a 200 response, SHALL store the returned sync key in IndexedDB
- **AND** SHALL trigger a full pull
- **AND** the server SHALL delete the code (one-time use)

#### Scenario: Target redeems an unknown or expired code
- **WHEN** the user pastes a code that the server does not recognize
- **THEN** the server SHALL respond with HTTP 404
- **AND** the client SHALL display an inline error ("Code not found or expired")

#### Scenario: Target redeems a malformed code
- **WHEN** the user pastes a string that is not 8 characters from the allowed alphabet
- **THEN** the client SHALL display a validation error and SHALL NOT call the server

#### Scenario: Brute-force protection
- **WHEN** many redeem requests come from the same IP within a short window
- **THEN** the server SHALL rate-limit the requests (10 per minute per IP)
- **AND** SHALL respond with HTTP 429 and a `Retry-After` header

### Requirement: Pairing via paste

When the user pastes a 22-character sync key directly, the system SHALL validate the format, store it, and trigger an initial full pull.

#### Scenario: User pastes a valid sync key
- **WHEN** the user pastes a 22-character base64url sync key and clicks "Pair"
- **THEN** the key SHALL be stored in IndexedDB
- **AND** a full pull from the server SHALL be triggered
- **AND** the Settings panel SHALL switch to the sync-on state

#### Scenario: User pastes a malformed key
- **WHEN** the user pastes a string that is not exactly 22 base64url characters
- **THEN** the client SHALL display an inline error and SHALL NOT call the server

#### Scenario: User pastes the same key already in use
- **WHEN** the user pastes a key that matches the one already stored on this device
- **THEN** the client SHALL display a notice ("Already paired with this key")
- **AND** SHALL NOT re-trigger a full pull

#### Scenario: User pastes a key with surrounding whitespace
- **WHEN** the user pastes a string with leading, trailing, or internal whitespace
- **THEN** the client SHALL trim the whitespace before validating
- **AND** SHALL treat the trimmed string as the candidate key

### Requirement: User creation via /sync/register

The server SHALL create a `users` row only when the client explicitly calls `POST /sync/register`. The server SHALL NOT create users lazily on other endpoints.

#### Scenario: First-time register
- **WHEN** a client calls `POST /sync/register` with a valid `X-Sync-Key` header
- **THEN** the server SHALL insert a row into `users (sync_key, created_at)` if one does not already exist
- **AND** SHALL respond with HTTP 204

#### Scenario: Register is rate-limited per IP
- **WHEN** many `POST /sync/register` requests come from the same IP within an hour
- **THEN** the server SHALL respond with HTTP 429 and a `Retry-After` header
- **AND** SHALL NOT create additional `users` rows above the per-IP quota

#### Scenario: Register is bounded by a global daily cap
- **WHEN** the global daily registration cap (default 1000) is reached
- **THEN** the server SHALL respond with HTTP 503 to all subsequent `POST /sync/register` requests
- **AND** the 503 response SHALL NOT count against any per-IP rate limit
- **AND** the cap SHALL be enforced by a single row in the `rate_limits` table with scope `register:global`

### Requirement: Register check order

The server SHALL evaluate registration caps in this order: (1) `register:global` rate limit, (2) `register:<ip>` rate limit, (3) `users` row count cap. A 503 from any of these SHALL NOT count against the per-IP rate limit (the per-IP counter is incremented only on a successful register or a 429 from the per-IP check itself).

#### Scenario: Global cap hit before per-IP
- **WHEN** the global rate limit is exhausted
- **AND** the per-IP rate limit is not
- **THEN** the server SHALL return 503 without incrementing the per-IP counter

#### Scenario: Per-IP cap hit before global
- **WHEN** the per-IP rate limit is exhausted
- **AND** the global rate limit is not
- **THEN** the server SHALL return 429 with `Retry-After` and SHALL NOT increment the global counter

#### Scenario: All caps exhausted
- **WHEN** all three checks fail (global, per-IP, users count)
- **THEN** the server SHALL return 503
- **AND** the response SHALL NOT distinguish which cap was hit

### Requirement: Global users row cap

The server SHALL enforce a hard cap on the total number of rows in the `users` table (default 100,000). This bounds the damage from distributed registration attacks where the per-IP and global daily limits are evaded.

#### Scenario: Register within users cap
- **WHEN** a client calls `POST /sync/register`
- **AND** the `users` table has fewer than the cap rows
- **THEN** the server SHALL process the registration normally

#### Scenario: Register at users cap
- **WHEN** a client calls `POST /sync/register`
- **AND** the `users` table already has the cap number of rows
- **THEN** the server SHALL respond with HTTP 503
- **AND** SHALL NOT create a new `users` row

### Requirement: Bearer-token authentication for sync routes (push and pull)

All sync data routes (`/sync/push`, `/sync/pull`, `/sync/otp`) SHALL require a valid `X-Sync-Key` header. The server SHALL reject requests with a missing, malformed, or unknown key.

#### Scenario: Request with a known key
- **WHEN** a request includes an `X-Sync-Key` header that is 22 base64url characters
- **AND** a row exists in `users` with that `sync_key`
- **THEN** the request SHALL proceed, scoped to that user's data

#### Scenario: Request with a missing header
- **WHEN** a request to a sync data route omits the `X-Sync-Key` header
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Request with an unknown key
- **WHEN** a request includes an `X-Sync-Key` header that does not match any row in `users`
- **THEN** the server SHALL respond with HTTP 401
- **AND** SHALL NOT create a new `users` row

#### Scenario: Request with a malformed key
- **WHEN** a request includes an `X-Sync-Key` header that is not 22 base64url characters
- **THEN** the server SHALL respond with HTTP 401 without consulting the database

### Requirement: Server stores only sync-relevant data

The server SHALL store exactly the data needed for sync, partitioned by sync key. The server SHALL NOT store article content, thumbnails, settings, or feed-fetching metadata.

#### Scenario: Feed subscription stored
- **WHEN** a client pushes a feed subscription
- **THEN** the server SHALL store the feed URL, the folder path (or null for root), the title, the deleted-tombstone flag, and per-field timestamps

#### Scenario: Read flag stored
- **WHEN** a client pushes a flag update
- **THEN** the server SHALL store the item ID, the feed URL (denormalized), the read value (1, 0, or null), the starred value (1, 0, or null), and per-field timestamps

#### Scenario: Article content is never stored
- **WHEN** any client request is processed
- **THEN** the server SHALL NOT receive or store article HTML, extracted content, thumbnails, or feed XML bodies

### Requirement: Monotonic server time

All server-side timestamps SHALL come from a monotonic counter in the `counters` table, not from `Date.now()` or any wall-clock source. The counter SHALL be incremented atomically on every server-side timestamp assignment.

#### Scenario: Timestamps are monotonic across the server
- **WHEN** the server assigns a timestamp to row R1 at operation N
- **AND** later assigns a timestamp to row R2 at operation N+10
- **THEN** R2's timestamp SHALL be greater than R1's timestamp
- **AND** this SHALL hold even if the wall clock regresses between the two operations

#### Scenario: Clock regression does not break the pull model
- **WHEN** the wall clock jumps backward by 5 minutes
- **AND** the server assigns new timestamps via the counter
- **THEN** rows stamped after the jump SHALL still be returned by a pull with `since=<pre_jump_value>`
- **AND** the pull response SHALL include the counter value as `serverTime`

#### Scenario: Pull response includes serverTime
- **WHEN** a client calls `GET /sync/pull`
- **THEN** the response SHALL include a `serverTime` field whose value is the current counter value
- **AND** the client SHALL use `max(currentLastSyncAt, serverTime)` as the new `lastSyncAt`

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

### Requirement: Push payload size cap and chunking

The server SHALL cap the size of a push payload, and the client SHALL chunk large dirty sets into multiple smaller pushes.

#### Scenario: Push within size limit
- **WHEN** a client pushes a payload whose serialized JSON body is at or below 1 MB
- **THEN** the server SHALL process it normally

#### Scenario: Push exceeds size limit
- **WHEN** a client pushes a payload whose serialized JSON body exceeds 1 MB
- **THEN** the server SHALL respond with HTTP 413
- **AND** the client SHALL split the payload into smaller chunks and retry

#### Scenario: Dirty set is chunked
- **WHEN** the dirty set has more than 500 entries
- **THEN** the client SHALL split it into chunks of 500 and push each chunk separately
- **AND** SHALL clear the dirty entries for each chunk only on its 2xx response

### Requirement: Pull protocol

The system SHALL provide a `GET /sync/pull?since=<monotonic_ms>` endpoint that returns all feeds and flags whose `row_at > since`, plus the server's current counter value.

#### Scenario: Pull returns only newer rows
- **WHEN** a client requests a pull with `since=<t>`
- **THEN** the server SHALL return only feeds and flags with `row_at > t`
- **AND** SHALL include a `serverTime` field in the response

#### Scenario: Initial pull on a paired device
- **WHEN** a freshly paired device requests a pull with `since=0`
- **THEN** the server SHALL return all feeds and flags for the user

#### Scenario: Pull with missing or null `since`
- **WHEN** a client requests a pull with `since` missing, null, or empty
- **THEN** the server SHALL treat it as `since=0` and return all server state for the key

### Requirement: Per-user row cap

The server SHALL enforce per-user row caps on feeds and flags. Pushes that would exceed the cap SHALL be rejected with HTTP 413.

#### Scenario: Push within cap
- **WHEN** a client pushes a payload that would not exceed 10,000 feeds or 1,000,000 flags for the user
- **THEN** the server SHALL accept the push

#### Scenario: Push exceeds cap
- **WHEN** a client pushes a payload that would exceed the cap
- **THEN** the server SHALL respond with HTTP 413
- **AND** the client SHALL surface the error in the Settings UI ("Sync storage limit reached")
- **AND** SHALL stop pushing until the user regenerates the key

### Requirement: In-Worker rate limiting

The server SHALL rate-limit sync requests using a D1-backed counter. The limits SHALL be per-IP for unauthenticated routes (`/sync/register`, `/sync/redeem`) and per-sync-key for authenticated routes (`/sync/push`, `/sync/pull`, `/sync/otp`).

#### Scenario: Rate limit on register
- **WHEN** more than 10 `POST /sync/register` requests come from the same IP within an hour
- **THEN** the server SHALL respond with HTTP 429 and a `Retry-After` header

#### Scenario: Rate limit on push
- **WHEN** more than 60 `POST /sync/push` requests come from the same sync key within a minute
- **THEN** the server SHALL respond with HTTP 429 and a `Retry-After` header

#### Scenario: Rate limit on otp
- **WHEN** more than 20 `POST /sync/otp` requests come from the same sync key within an hour
- **THEN** the server SHALL respond with HTTP 429 and a `Retry-After` header

#### Scenario: Rate limit on redeem
- **WHEN** more than 10 `POST /sync/redeem` requests come from the same IP within a minute
- **THEN** the server SHALL respond with HTTP 429 and a `Retry-After` header

#### Scenario: Client respects Retry-After
- **WHEN** the server responds with HTTP 429
- **THEN** the client SHALL wait at least the value of `Retry-After` before retrying
- **AND** SHALL NOT retry indefinitely

### Requirement: No CORS on sync routes

The server SHALL NOT set `Access-Control-Allow-Origin` on any `/sync/*` route, and SHALL reject preflight `OPTIONS` requests with HTTP 403. Sync is same-origin only.

#### Scenario: Preflight request is rejected
- **WHEN** a cross-origin client sends an `OPTIONS` request to a sync route
- **THEN** the server SHALL respond with HTTP 403

#### Scenario: Sync responses do not include CORS headers
- **WHEN** the server responds to any sync route
- **THEN** the response SHALL NOT include `Access-Control-Allow-Origin`
- **AND** the response SHALL NOT include `Access-Control-Allow-Headers`

### Requirement: First-time setup ordering

When a user enables sync on a device that already has local state, the system SHALL perform an initial sync in a defined order that preserves both local and server data.

#### Scenario: First-time enable on a device with local data
- **WHEN** the user enables sync for the first time
- **AND** the device has N local feeds and M local flags
- **AND** the server has P feeds and Q flags for the same sync key
- **THEN** the client SHALL push all local state to the server
- **AND** SHALL pull all server state (`since=0`)
- **AND** SHALL merge in memory with per-field server-newer-wins
- **AND** SHALL apply the merged state to local IndexedDB
- **AND** SHALL re-push the merged state to the server to ensure convergence

#### Scenario: Empty local + populated server
- **WHEN** the device has no local data
- **AND** the server has feeds and flags
- **THEN** after the first-time merge, the local state SHALL match the server state

#### Scenario: Populated local + empty server
- **WHEN** the device has local feeds and flags
- **AND** the server has no data for the sync key
- **THEN** after the first-time merge, the server SHALL contain the local state
- **AND** the local state SHALL be unchanged

#### Scenario: Local newer wins
- **WHEN** the local row has a field whose timestamp is newer than the server's
- **THEN** after the first-time merge, the server SHALL have the local value for that field
- **AND** the local value SHALL be preserved

#### Scenario: Server newer wins
- **WHEN** the server row has a field whose timestamp is newer than the local's
- **THEN** after the first-time merge, the local store SHALL have the server value for that field
- **AND** the server value SHALL be preserved

### Requirement: Client pushes on local change

When the user takes a sync-relevant action on one device, the change SHALL be queued in an in-memory dirty set (persisted to IndexedDB on debounce) and pushed to the server after a debounce, with exponential backoff on failure.

#### Scenario: Mark-read is queued
- **WHEN** the user marks an item as read
- **THEN** a dirty record for that flag SHALL be appended to the in-memory dirty set
- **AND** the IDB meta store SHALL be updated on debounce, beforeunload, or app-pause (not on every enqueue)
- **AND** a debounced (1 second) push SHALL be scheduled

#### Scenario: Rapid changes coalesce
- **WHEN** the user marks many items as read in quick succession
- **THEN** the dirty set SHALL accumulate all changes
- **AND** a single push batch SHALL send all of them after the debounce settles

#### Scenario: Push failure with exponential backoff
- **WHEN** a push returns 5xx, a network error, or a non-2xx response
- **THEN** the dirty set SHALL be preserved
- **AND** the client SHALL retry with linear backoff (1s, 2s, 5s, 10s, max 60s)
- **AND** SHALL respect `Retry-After` on 429 responses

#### Scenario: Dirty entries cleared on success
- **WHEN** a push for a batch of dirty entries returns 2xx
- **THEN** those entries SHALL be removed from the dirty set
- **AND** entries in the same push that failed SHALL be retained

### Requirement: Client pulls on boot, focus, and online

The system SHALL pull server state on app boot, when the browser tab becomes visible, and when the browser fires an `online` event, so that changes from other devices are reflected.

#### Scenario: App boot pulls since last sync
- **WHEN** the user opens the app
- **AND** sync is enabled
- **AND** the boot order is: load settings → pull + apply → reload feeds → reload items
- **THEN** the client SHALL request a pull with `since=lastSyncAt`
- **AND** SHALL apply the returned state to the local IndexedDB
- **AND** SHALL update `lastSyncAt` to `max(currentLastSyncAt, serverTime)`

#### Scenario: Tab focus triggers a pull
- **WHEN** the browser tab becomes visible
- **AND** the previous successful pull was more than 30 seconds ago
- **THEN** a pull SHALL be triggered

#### Scenario: Browser comes online triggers a pull
- **WHEN** the browser fires an `online` event
- **THEN** a pull SHALL be triggered

### Requirement: Applied remote state updates the local database

When a pull returns remote state, the client SHALL apply it to the local IndexedDB in a way that is consistent with the local data model.

#### Scenario: Remote feed is added
- **WHEN** a pull returns a feed that does not exist locally
- **THEN** the client SHALL upsert it into the local `feeds` store

#### Scenario: Remote feed is tombstoned
- **WHEN** a pull returns a feed with `deleted=1`
- **AND** the local store has the feed
- **AND** the remote `deleted_at` is newer than the local `lastFetched` for the same URL
- **THEN** the client SHALL call `unsubscribeFeed(feedUrl)` to remove the feed and its items

#### Scenario: Remote feed is tombstoned but local is fresher
- **WHEN** a pull returns a feed with `deleted=1`
- **AND** the local `lastFetched` is newer than the remote `deleted_at`
- **THEN** the client SHALL keep the local feed (the local may have re-fetched or re-subscribed after the remote delete)
- **AND** SHALL NOT call `unsubscribeFeed`

#### Scenario: Remote feed is tombstoned but local never had it
- **WHEN** a pull returns a feed with `deleted=1`
- **AND** the local store does not have the feed
- **THEN** the client SHALL take no action

#### Scenario: Re-subscribe clears server-side tombstone
- **WHEN** a client pushes a non-`deleted` write (e.g., `folder`, `title`) to a row whose server-side `deleted=1`
- **THEN** the server SHALL clear the tombstone (`deleted=0, deleted_at=NULL`) as a safety net before applying the PATCH
- **AND** the client SHOULD also push an explicit `deleted: { value: 0, at: <now> }` to make the re-subscribe intent explicit on the wire

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

### Requirement: Item-ID format tolerates URLs containing `::`

The system SHALL handle item IDs whose feed URL contains the `::` character sequence by encoding the feed URL before constructing the item ID and splitting at the last `::` on parse.

#### Scenario: Feed URL contains `::`
- **WHEN** a feed URL contains the literal sequence `::`
- **THEN** the client SHALL `encodeURIComponent` the feed URL before concatenation
- **AND** on parse, SHALL split at the *last* `::` occurrence to recover the feed URL
- **AND** a test SHALL cover this case

### Requirement: Sync status UI in Settings

The Settings panel SHALL include a Sync section, conditionally rendered when the server reports that sync is available via `GET /sync/capabilities`.

#### Scenario: Sync section is hidden when server has no D1 binding
- **WHEN** `GET /sync/capabilities` returns 404 or a body lacking `sync: true`
- **THEN** the Sync section SHALL NOT be rendered in Settings
- **AND** the capability check SHALL be performed on each page load (not cached across reloads)

#### Scenario: Sync-on state displays key and status
- **WHEN** sync is enabled
- **THEN** the Settings panel SHALL display a "Pair device" button, a "Last synced" relative time, a "Sync now" button, and a "Regenerate" button

#### Scenario: Last synced updates while drawer is open
- **WHEN** the Settings drawer is open
- **THEN** the "Last synced" string SHALL be recomputed every 30 seconds

#### Scenario: Sync-off state displays the enable flow
- **WHEN** sync is disabled
- **THEN** the Settings panel SHALL display a description of what sync does
- **AND** an "Enable sync" button that opens the pairing modal in receiving mode

#### Scenario: Disabling sync requires confirmation
- **WHEN** the user toggles sync off while it is currently enabled
- **THEN** the system SHALL display a confirm dialog with the text: "Your other devices will stop syncing. Server data is kept until you generate a new key. Continue?"
- **AND** SHALL only clear the local sync key and the dirty set on explicit confirmation

### Requirement: Dirty set cleared on toggle off

When sync is disabled, the system SHALL clear both the local sync key AND the dirty set in IndexedDB. Toggle-off also clears `lastSyncAt` (so a future re-enable with a new key performs a full first-time merge) but does not affect `mcpEnabled` or any other settings.

#### Scenario: User disables sync with pending changes
- **WHEN** the user disables sync
- **AND** the dirty set has entries
- **THEN** the system SHALL clear the local sync key
- **AND** SHALL clear the dirty set
- **AND** SHALL clear `lastSyncAt`
- **AND** SHALL NOT push the pending changes to any server
- **AND** SHALL NOT modify `mcpEnabled` or other settings

#### Scenario: User re-enables sync with a new key
- **WHEN** the user toggles sync back on after disabling it
- **AND** a new sync key is generated (or a different key is pasted)
- **THEN** the dirty set SHALL be empty
- **AND** `lastSyncAt` SHALL be null
- **AND** the new key SHALL start with a clean slate and SHALL trigger the first-time setup merge

### Requirement: Regenerate preserves dirty set

Regenerating the sync key (without disabling sync) SHALL preserve the local dirty set and `lastSyncAt`. The user wants continuity of state across the regeneration. The next push or pull SHALL register the new key on the server before using it, and SHALL NOT surface a 401 error to the user as a result of regeneration.

#### Scenario: User regenerates the key
- **WHEN** the user clicks "Regenerate" and confirms
- **THEN** the system SHALL generate a new sync key
- **AND** SHALL replace the local sync key
- **AND** SHALL preserve the dirty set
- **AND** SHALL preserve `lastSyncAt`
- **AND** the next push or pull SHALL call `POST /sync/register` with the new key before any other sync request
- **AND** if the registration fails, the client SHALL surface a one-time error in the Settings UI ("Sync key not registered; retrying") and SHALL retry the registration on the next push or pull

#### Scenario: 401 from a known-locally key triggers auto-register
- **WHEN** the server returns 401 for a request
- **AND** the local sync key is present in IndexedDB (i.e., this is not a stranger's request)
- **THEN** the client SHALL call `POST /sync/register` with the local key
- **AND** SHALL retry the original request
- **AND** this auto-register path SHALL be the only way the client creates server state; it SHALL NOT be triggered for any other failure mode
- **AND** SHALL be rate-limited by the per-IP and global registration limits as for any other register call

### Requirement: IDB-cleared client with key in hand

When a client with an empty IndexedDB but a stored sync key is paired (e.g., browser storage cleared, key restored from backup), the system SHALL perform a full pull and SHALL NOT push any local state (which is empty).

#### Scenario: Empty local state with stored key
- **WHEN** the app boots with a stored sync key
- **AND** the local IDB has no feeds or flags
- **THEN** the client SHALL perform a full pull (`since=0`)
- **AND** SHALL NOT push any local state
- **AND** SHALL apply the pulled state to local IDB

### Requirement: Sync is opt-in

The system SHALL NOT enable, configure, or perform sync until the user explicitly toggles sync on in Settings. Existing users SHALL see no change in behavior until they opt in.

#### Scenario: User with sync disabled sees no sync activity
- **WHEN** sync is not enabled in the user's settings
- **THEN** no push requests SHALL be sent
- **AND** no pull requests SHALL be sent on boot or focus
- **AND** no `enqueueFeed`, `enqueueFeedDelete`, `enqueueFlag`, `enqueueOtp`, or `redeemCode` function SHALL be called from any non-sync path

#### Scenario: User enables sync for the first time
- **WHEN** the user toggles sync on with no prior key
- **THEN** a sync key SHALL be generated
- **AND** the first-time setup merge SHALL be triggered
- **AND** the Settings panel SHALL switch to the sync-on state

#### Scenario: User enables sync mid-session
- **WHEN** the app has already booted
- **AND** the user toggles sync on from the Settings drawer
- **THEN** the first-time setup merge SHALL be triggered inline (not deferred to the next boot)
- **AND** the Settings panel SHALL show a "Syncing…" indicator while the merge is in progress

### Requirement: Cross-version protocol compatibility

Server payloads and client code SHALL be tolerant of unknown fields. A client that does not recognize a field in a pull response SHALL ignore it. A client that omits a field in a push payload SHALL NOT cause the server to delete that field on the row.

#### Scenario: Client receives a v1.1 pull response on a v1.0 client
- **WHEN** the server adds a new field to a row in v1.1
- **AND** a v1.0 client receives the row in a pull response
- **THEN** the v1.0 client SHALL ignore the unknown field
- **AND** SHALL continue to process the known fields normally

#### Scenario: Client omits a field in push
- **WHEN** a client pushes a row that does not include a particular field
- **THEN** the server SHALL leave that field unchanged on the row
- **AND** SHALL NOT set the field to NULL

### Requirement: Server never logs the sync key or user data

The server SHALL NOT log the value of the `X-Sync-Key` header, the `users.sync_key` value, the `feeds.feed_url` value, the `flags.item_id` value, or any other data that would identify a specific user's reading list.

#### Scenario: Auth middleware suppresses key from logs
- **WHEN** the bearer-token middleware processes a request
- **THEN** the raw key value SHALL NOT appear in any console output, error report, or telemetry

#### Scenario: Server errors do not leak user data
- **WHEN** the server returns an error response
- **THEN** the error body SHALL NOT contain the request's `X-Sync-Key` value or any feed URL / item ID from the request

#### Scenario: 400 error response on malformed push
- **WHEN** the server responds with HTTP 400 to a malformed push payload
- **THEN** the error body SHALL describe the field that failed validation by name
- **AND** SHALL NOT include the user-supplied value of that field

### Requirement: Stolen device recovery via key regeneration

The system SHALL provide no server-side key revocation mechanism. The only remediation for a stolen device is to regenerate the key on a trusted device and pair the new one.

#### Scenario: User regenerates key after device loss
- **WHEN** the user opens Settings on a trusted device
- **AND** clicks "Regenerate" and confirms
- **THEN** a new sync key SHALL be generated
- **AND** the new key SHALL be stored locally
- **AND** the old key's data on the server SHALL be orphaned (no migration is performed)

#### Scenario: Stolen device's data is not auto-purged
- **WHEN** a stolen device has the previous sync key
- **THEN** the server SHALL continue to accept push and pull requests with that key
- **AND** the only way to revoke access is for the user to rotate the key on a trusted device
- **AND** the Settings UI SHALL document this on the regenerate confirmation

### Requirement: Key backup prompt

When a sync key is first displayed in the Settings panel, the system SHALL prompt the user to back up the key in a password manager or other secure location.

#### Scenario: First display of sync key
- **WHEN** the user enables sync and the sync key is first shown
- **THEN** the UI SHALL display a non-modal notice: "Save this key somewhere safe. If you lose it, server data is not recoverable."
- **AND** SHALL offer a "Copy" button

### Requirement: Tombstone GC

Tombstoned feed rows (`deleted=1`) SHALL be removed by a scheduled server-side task after 30 days.

#### Scenario: Scheduled tombstone cleanup
- **WHEN** a daily cron trigger runs
- **THEN** the server SHALL delete rows from `feeds` where `deleted=1 AND deleted_at < now - 30 days`
- **AND** SHALL delete rows from `rate_limits` older than the largest window

#### Scenario: Re-subscribe during tombstone window
- **WHEN** a device pushes a subscription to a URL whose server row is tombstoned
- **THEN** the server SHALL clear the tombstone (`deleted=0`) and update the subscription
- **AND** SHALL NOT treat the push as an error

### Requirement: Server is Workers-only

The sync feature SHALL be available only when the server is deployed on Cloudflare Workers with a D1 binding. Self-hosted deployments (Node, Bun) SHALL NOT implement sync.

#### Scenario: Node/Bun adapter has no D1 binding
- **WHEN** the server is started without a D1 binding
- **THEN** the sync routes SHALL NOT be registered
- **AND** `GET /sync/capabilities` SHALL return 404
- **AND** the browser SHALL hide the Sync section in Settings

#### Scenario: Workers adapter has D1 binding
- **WHEN** the server is started with a D1 binding
- **THEN** the sync routes SHALL be registered
- **AND** `GET /sync/capabilities` SHALL return 200 with `{ sync: true }`
- **AND** the browser SHALL render the Sync section in Settings
