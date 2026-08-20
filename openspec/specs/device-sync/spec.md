# device-sync Specification

## Purpose
TBD - created by archiving change add-device-sync. Update Purpose after archive.
## Requirements
### Requirement: Sync key generation and storage

When the user enables device sync, the system SHALL generate a 128-bit cryptographically random sync key, encode it as URL-safe base64 (22 characters), and persist it in the browser's IndexedDB. The sync key SHALL be the user's identity for sync purposes; no account, email, or password is required.

#### Scenario: User enables sync for the first time
- **WHEN** the user toggles "Sync" on in Settings and no sync key is currently stored
- **THEN** the system SHALL generate 16 random bytes via `crypto.getRandomValues`
- **AND** SHALL encode the result as base64url
- **AND** SHALL store the encoded string in the IndexedDB meta store under the sync settings key
- **AND** SHALL expand the Sync section to the sync-on state (no pairing modal is opened; pairing is available from the "Pair another device" row)

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

The system SHALL provide a single pairing modal that serves both pairing directions, driven by this device's state: a device with a stored sync key opens it in source mode (showing an 8-character server-generated OTP code and a QR code), and a device without a stored key opens it in receiving mode (accepting an 8-character code or a 22-character sync key, plus camera scanning). The two directions SHALL NOT be presented as parallel options; the receiving direction SHALL remain reachable from source mode via a secondary link. The system SHALL NOT detect the device type.

#### Scenario: Source device shows all three flows
- **WHEN** a user with sync enabled opens the pairing modal
- **THEN** the modal SHALL present the source direction as the primary content: an 8-character OTP code with a copy button, a QR code, a 5-minute countdown, and the instruction to enter the code or scan the QR on the other device
- **AND** the code SHALL refresh automatically when it expires, resetting the countdown
- **AND** when a code refresh fails, the modal SHALL display an error with a retry affordance and SHALL NOT silently clear the code

#### Scenario: Target device (no existing key) opens the modal
- **WHEN** a user without a stored sync key opens the pairing modal
- **THEN** the modal SHALL present the receiving direction as the primary content: an input that accepts an 8-character code or a 22-character sync key, a "Pair" action, and a "Scan QR" action
- **AND** SHALL NOT display the code or QR half (there is no group to share yet)
- **AND** submitting an 8-character code SHALL redeem it via the server, store the returned key, trigger a first-time sync, and confirm success
- **AND** submitting a 22-character base64url key SHALL validate it locally without a server call, store it, trigger a first-time sync, and confirm success
- **AND** submitting a value that is neither SHALL show an inline validation error without calling the server
- **AND** submitting the key already in use SHALL show a notice ("Already paired with this key") without re-triggering a sync

#### Scenario: Modal layout on wide and narrow screens
- **WHEN** the modal is rendered on a wide or narrow screen
- **THEN** the active direction SHALL be a single primary section with consistent layout across both widths
- **AND** the alternative direction SHALL be reachable only via a secondary link

#### Scenario: Target scans a QR code
- **WHEN** the user activates "Scan QR" with a camera available
- **THEN** the system SHALL open the camera scanner overlay
- **AND** on a successful scan of a pairing QR for this origin, SHALL redeem the embedded code and pair
- **AND** when no camera is available, the "Scan QR" action SHALL be disabled with an explanatory tooltip

#### Scenario: Source mode offers the receiving direction
- **WHEN** a user with sync enabled opens the pairing modal
- **THEN** the modal SHALL include a secondary link ("Enter a code from another device instead") that switches it to the receiving direction
- **AND** the receiving direction SHALL include a link back to the source direction

#### Scenario: Codes are grouped for readability
- **WHEN** the pairing modal displays an 8-character code
- **THEN** the code SHALL be displayed grouped as four characters, a dash, and four characters (e.g., "abcd-efgh")
- **AND** the receiving input SHALL accept the code with or without the grouping dash, in any letter case
- **AND** sync keys SHALL remain case-sensitive and SHALL NOT be case-folded

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
- **WHEN** more than 100 `POST /sync/register` requests come from the same IP within an hour
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

### Requirement: In-Worker rate limiting

The server SHALL rate-limit sync requests using a D1-backed counter. The limits SHALL be per-IP for unauthenticated routes (`/sync/register`, `/sync/redeem`) and per-sync-key for authenticated routes (`/sync/push`, `/sync/pull`, `/sync/otp`).

#### Scenario: Rate limit on register
- **WHEN** more than 100 `POST /sync/register` requests come from the same IP within an hour
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
- **AND** the remote `deleted_at` is newer than the local user-mutation time (`modifiedAt`, or `max(urlAt, titleAt, tagsAt)` for legacy records)
- **THEN** the client SHALL NOT push that feed
- **AND** SHALL apply the tombstone locally, removing the feed and its items
- **AND** if the local user-mutation time is newer than the remote `deleted_at`, the client SHALL keep the local feed (the user deliberately touched it after the remote delete) and SHALL NOT push it in a way that revives the server tombstone

#### Scenario: Local feed whose URL changed on the server after deletion
- **WHEN** the device has a local feed whose `feed_id` exists on the server as a tombstone carrying a different URL (e.g., the feed was renamed on the other device and then deleted)
- **AND** the remote `deleted_at` is newer than the local user-mutation time (`modifiedAt`, or `max(urlAt, titleAt, tagsAt)` for legacy records)
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
- **THEN** the Settings panel SHALL display, in order: a status line (last sync activity plus the display-only 4-character group fingerprint, with no copy affordance), a "Sync now" action, a "Pair another device" row that opens the unified pairing modal in source mode, an "Agent access" row that opens the agents modal, and a separated "Regenerate" row
- **AND** the group fingerprint SHALL be derived one-way from the sync key and SHALL NOT be used by any pairing flow
- **AND** the status line SHALL show the last error with its relative time when the last sync failed, the pending change count when changes are waiting, "Never synced" when no sync has ever succeeded, and otherwise the relative time of the last successful sync

#### Scenario: Last synced updates while drawer is open
- **WHEN** the Settings drawer is open
- **THEN** the status line's relative time SHALL be recomputed every 30 seconds

#### Scenario: Sync-off state displays the enable flow
- **WHEN** sync is disabled
- **THEN** the Settings panel SHALL display an "Enable sync" toggle that generates a key and expands the Sync section to the sync-on state
- **AND** SHALL display a "Join an existing sync" row that opens the unified pairing modal in receiving mode

#### Scenario: Disabling sync requires confirmation
- **WHEN** the user toggles sync off while it is currently enabled
- **THEN** the system SHALL display a confirm dialog with the text: "Your other devices will stop syncing. Server data is kept until you generate a new key. Continue?"
- **AND** SHALL only clear the local sync key and the dirty set on explicit confirmation

### Requirement: Enable sync clears state on failure
If `triggerFirstTime()` (and thus the initial push + pull) fails for any reason during `enableSync()`, the system SHALL call `disableSync()` to clear the local sync key, `lastSyncAt`, and dirty set. This ensures the toggle shows as OFF on failure and a retry generates a fresh key rather than retrying a stale one.

#### Scenario: Enable sync fails and clears key
- **WHEN** the user enables sync
- **AND** `triggerFirstTime()` throws (registration rate-limited, network failure, server error)
- **THEN** the system SHALL call `disableSync()` to clear local sync state
- **AND** the Settings panel SHALL show the sync toggle in the OFF state
- **AND** the error SHALL propagate to the caller for UI surfacing

#### Scenario: Enable sync succeeds normally
- **WHEN** the user enables sync
- **AND** `triggerFirstTime()` completes without error
- **THEN** the sync key SHALL remain stored
- **AND** the Settings panel SHALL show the sync toggle in the ON state

### Requirement: Sync enable errors surfaced in UI
The Settings drawer SHALL display an inline error message when enabling sync fails. The error SHALL be rendered below the sync toggle with the text "Failed to enable sync" and the error details logged to the browser console.

#### Scenario: Error shown on sync failure
- **WHEN** the user enables sync
- **AND** the enable operation fails
- **THEN** an inline error message SHALL appear below the sync toggle in the Settings drawer
- **AND** the error details SHALL be logged to the browser console via `console.error`

#### Scenario: Error cleared on next attempt
- **WHEN** a sync error message is displayed
- **AND** the user attempts to enable sync again
- **THEN** the previous error message SHALL be cleared before the new attempt

### Requirement: Agent access management

The Settings Sync section SHALL provide an "Agent access" row that opens a modal listing paired agent tokens and allowing revocation. Revocation SHALL require confirmation.

#### Scenario: Agent tokens are listed
- **WHEN** the user opens the agents modal
- **THEN** the modal SHALL list each paired agent token with its fingerprint, scope, creation time, and last-seen time
- **AND** SHALL show a placeholder when no agents are paired

#### Scenario: Revoking an agent token requires confirmation
- **WHEN** the user activates revoke for a token
- **THEN** the system SHALL display a confirmation dialog naming the token's fingerprint
- **AND** SHALL revoke the token only on explicit confirmation
- **AND** after the dialog closes, the agents modal SHALL be shown again with the token removed

#### Scenario: Pairing code is minted on demand
- **WHEN** the user opens the agents modal
- **THEN** SHALL NOT mint an agent pairing code
- **WHEN** the user activates "Pair an agent"
- **THEN** the modal SHALL mint an 8-character code with a 5-minute countdown
- **AND** SHALL embed the code in a "Copy prompt" action and a secondary terminal-pairing path rather than displaying it
- **AND** a mint failure SHALL show an inline error and return the modal to the un-minted state

#### Scenario: Expired pairing code offers a new one
- **WHEN** the displayed agent pairing code reaches its 5-minute expiry
- **THEN** the modal SHALL show an "Code expired" state with a "Get a new code" action
- **AND** SHALL hide the "Copy prompt" action and the terminal-pairing path while expired

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

#### Scenario: Auto-register failure logs to console
- **WHEN** `POST /sync/register` returns a non-2xx response (e.g., 429) during the auto-register flow
- **THEN** the client SHALL `console.error` the failure with the status code and retry-after value
- **AND** SHALL NOT retry indefinitely

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
- **WHEN** a device pushes a feed payload with `deleted: { value: 0 }` and a `feedUrl` for a URL whose server row is tombstoned
- **THEN** the server SHALL revive the tombstoned row (clear the tombstone and update the subscription)
- **AND** SHALL NOT treat the push as an error

#### Scenario: Metadata push during tombstone window
- **WHEN** a device pushes a feed payload without the `deleted` field for a URL whose server row is tombstoned
- **THEN** the server SHALL leave the tombstone in place
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

### Requirement: siftctl group code

`siftctl status` SHALL display a short, display-only group identifier derived from the sync key — identical to the web app's `Group XK7B` — so a CLI user can confirm two devices belong to the same sync group. The sync key itself SHALL NOT be exposed.

#### Scenario: status shows the group code when paired

- **WHEN** `siftctl status` runs with a token configured
- **AND** the server supports `GET /sync/status`
- **THEN** the output SHALL include a `Group:` line with the group fingerprint (first 20 bits of SHA-256 of the sync key, 4 Crockford base32 characters)
- **AND** the fingerprint SHALL equal the web app's `fingerprintSyncKey` result for the same sync key

#### Scenario: status is unaffected on older servers

- **WHEN** `siftctl status` runs with a token configured
- **AND** the server returns 404 for `GET /sync/status` (predates the endpoint)
- **THEN** the command SHALL still exit 0
- **AND** the group line SHALL be omitted (text) / `groupFingerprint` SHALL be null (`--json`)

#### Scenario: status requires a valid credential

- **WHEN** `GET /sync/status` is called without a valid master key or agent token
- **THEN** the server SHALL return 401

