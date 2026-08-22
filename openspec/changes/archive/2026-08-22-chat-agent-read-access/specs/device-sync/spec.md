## MODIFIED Requirements

### Requirement: Bearer-token authentication for sync routes (push and pull)

All sync data routes SHALL require a valid credential. `/sync/push` SHALL require a valid `X-Sync-Key` header. `/sync/pull` SHALL accept either a valid `X-Sync-Key` header or a valid agent pairing code in the `code` query parameter. The server SHALL reject requests with a missing, malformed, or unknown header, and SHALL reject pulls whose code is unknown, expired, or not an agent-kind code. Token authentication SHALL reject tokens whose sync key no longer exists in `users` — rotating the sync key SHALL orphan all tokens minted under it.

#### Scenario: Request with a known key

- **WHEN** a request includes an `X-Sync-Key` header that is 22 base64url characters
- **AND** a row exists in `users` with that `sync_key`
- **THEN** the request SHALL proceed, scoped to that user's data

#### Scenario: Token whose sync key was rotated

- **WHEN** a request presents an agent token
- **AND** the `users` row for the token's sync key is marked rotated (the key was regenerated)
- **THEN** the server SHALL respond with HTTP 401
- **AND** SHALL NOT return any user data

#### Scenario: Request with a missing header

- **WHEN** a request to `/sync/push` or `/sync/pull` omits the `X-Sync-Key` header and any `code` query parameter
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Request with an unknown key

- **WHEN** a request includes an `X-Sync-Key` header that does not match any row in `users`
- **THEN** the server SHALL respond with HTTP 401
- **AND** SHALL NOT create a new `users` row

#### Scenario: Request with a malformed key

- **WHEN** a request includes an `X-Sync-Key` header that is not 22 base64url characters
- **THEN** the server SHALL respond with HTTP 401 without consulting the database

#### Scenario: Pull authenticated with a pairing code

- **WHEN** a request to `/sync/pull` includes a valid, unexpired agent pairing code in the `code` query parameter
- **THEN** the request SHALL proceed, scoped to the code's sync key
- **AND** SHALL be read-only (the pull route only reads; codes are never accepted by write routes)

#### Scenario: Push with only a code

- **WHEN** a request to `/sync/push` includes a `code` query parameter but no `X-Sync-Key` header
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Pull with an invalid code

- **WHEN** a request to `/sync/pull` includes a `code` query parameter that is unknown, expired, or not an agent-kind code
- **THEN** the server SHALL respond with HTTP 404
- **AND** SHALL NOT return any user data

### Requirement: Regenerate preserves dirty set

Regenerating the sync key (without disabling sync) SHALL preserve the local dirty set and `lastSyncAt`. The user wants continuity of state across the regeneration. Regeneration SHALL call `POST /sync/rotate` (old key in the `X-Sync-Key` header, new key in the body), which SHALL register the new key and SHALL mark the old key's users row as rotated. A rotated key SHALL be permanently dead: master-key auth and agent-token auth SHALL reject it with 401, and `POST /sync/register` SHALL refuse to recreate it (403). Other devices holding the old key therefore lose access and MUST re-pair with the new key; every agent token minted under the old key stops working. The client SHALL NOT surface a 401 error to the user as a result of regeneration.

#### Scenario: User regenerates the key

- **WHEN** the user clicks "Regenerate" and confirms
- **THEN** the system SHALL generate a new sync key
- **AND** SHALL replace the local sync key
- **AND** SHALL call `POST /sync/rotate` with the old key in the header and the new key in the body
- **AND** SHALL preserve the dirty set
- **AND** SHALL preserve `lastSyncAt`
- **AND** the next push or pull SHALL use the new key

#### Scenario: 401 from a known-locally key triggers auto-register

- **WHEN** the server returns 401 for a request
- **AND** the local sync key is present in IndexedDB
- **THEN** the client SHALL NOT call `POST /sync/register` in response
- **AND** SHALL surface the sync failure in the Settings UI
- **AND** recovery SHALL require explicit pairing or regeneration — a rotated key must stay dead, so a 401 is final

#### Scenario: Auto-register failure logs to console
- **WHEN** `POST /sync/register` returns a non-2xx response (e.g., 429) during the auto-register flow
- **THEN** the client SHALL `console.error` the failure with the status code and retry-after value
- **AND** SHALL NOT retry indefinitely

#### Scenario: Old key is dead after rotation

- **WHEN** a client requests any sync route with a key whose users row is marked rotated
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Register refuses a rotated key

- **WHEN** a client calls `POST /sync/register` with a key whose users row is marked rotated
- **THEN** the server SHALL respond with HTTP 403
- **AND** SHALL NOT recreate the users row

#### Scenario: Agent tokens die with the rotated key

- **WHEN** an agent token minted under a key that has since been rotated is presented
- **THEN** the server SHALL respond with HTTP 401

### Requirement: Pull protocol

The system SHALL provide a `GET /sync/pull?since=<epoch_ms>` endpoint that returns all feeds and flags whose `row_at >= since`, plus the server's current time. The inclusive comparison ensures a row stamped in the same millisecond as the reported `serverTime` is delivered on the next pull (the cursor strictly advances, so delivery remains exactly-once). The endpoint SHALL authenticate via `X-Sync-Key` header or agent pairing code (`code` query parameter). Pull responses SHALL include `Cache-Control: no-store` so shared caches cannot replay one user's feed and flag state to another.

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

#### Scenario: Pull responses are not cached

- **WHEN** the server responds to any pull request, authenticated by header or by code
- **THEN** the response SHALL include `Cache-Control: no-store`
