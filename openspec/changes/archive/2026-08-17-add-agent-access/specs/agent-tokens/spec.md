## ADDED Requirements

### Requirement: Agent token minting

The system SHALL provide a `POST /sync/tokens` endpoint, authenticated with the master sync key, that issues a short-lived 8-character pairing code (same alphabet as device pairing codes) bound to the requesting sync key. The code SHALL expire after 5 minutes, SHALL be one-time use, and SHALL be rate-limited per sync key on a mint scope separate from device code minting.

#### Scenario: Mint succeeds
- **WHEN** an authenticated client (master sync key) calls `POST /sync/tokens`
- **THEN** the server SHALL respond with a JSON body containing the code and its expiry timestamp (in milliseconds, matching the device pairing code response)
- **AND** the code SHALL be redeemable only by the same sync key the code was minted for

#### Scenario: Mint without master key
- **WHEN** an unauthenticated request, or a request authenticated with an agent token, calls `POST /sync/tokens`
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Mint rate limit exceeded
- **WHEN** the minting sync key exceeds the per-window mint limit
- **THEN** the server SHALL respond with HTTP 429 and a `Retry-After` header

#### Scenario: Minted codes expire
- **WHEN** an agent pairing code is not redeemed within 5 minutes of minting
- **THEN** the code SHALL no longer be redeemable
- **AND** the code SHALL be swept by the same scheduled cleanup that removes expired device pairing codes

### Requirement: Agent token redemption

The system SHALL provide a `POST /sync/tokens/redeem` endpoint that exchanges a valid agent pairing code for a token. The token SHALL be a 23-character credential beginning with the letter `t` and SHALL NOT match the master-key format (`KEY_FORMAT_RE`, exactly 22 characters), so a token can never be mistaken for a master key or accepted by master-key-only paths. The token SHALL be derived from at least 128 bits of randomness, SHALL be bound to the code's sync key, and SHALL carry an `rw` scope. Redemption SHALL be one-time use, rate-limited per IP on a scope separate from device code redemption, and SHALL NOT return the master sync key.

#### Scenario: Redeem succeeds
- **WHEN** a caller posts a valid, unexpired agent pairing code to `POST /sync/tokens/redeem`
- **THEN** the server SHALL respond with a JSON body containing the token
- **AND** SHALL invalidate the code (one-time use)
- **AND** the token SHALL authenticate with the `rw` scope against the code's sync key
- **AND** the token SHALL NOT equal or encode the master sync key

#### Scenario: Token format never matches the master-key format
- **WHEN** the server (or any client) validates a token against the sync-key format
- **THEN** the token SHALL fail validation (a token is 23 characters and begins with `t`)
- **AND** a master key SHALL never validate as a token

#### Scenario: Redeem with invalid or expired code
- **WHEN** a caller posts a malformed, unknown, or expired code
- **THEN** the server SHALL respond with HTTP 404
- **AND** SHALL NOT leak whether the code existed

#### Scenario: Redeem rate limit exceeded
- **WHEN** the caller's IP exceeds the per-window redeem limit on the agent scope
- **THEN** the server SHALL respond with HTTP 429 and a `Retry-After` header

### Requirement: Agent token authentication and scope enforcement

The system SHALL accept agent tokens on the `X-Sync-Key` header as an alternative to the master sync key, and SHALL enforce an explicit route allowlist: an agent token SHALL be permitted ONLY on `GET /sync/pull` and `POST /sync/push`. Every other route — including `POST /sync/otp` (device code minting), `POST /sync/register`, `POST /sync/tokens`, `GET /sync/tokens`, and `DELETE /sync/tokens` — SHALL reject requests authenticated with an agent token with HTTP 401. The middleware SHALL carry the principal type (master key or token) in the request context so routes and rate limiting can distinguish them. The server SHALL record a `last_seen` timestamp on a token when it authenticates, throttled to at most once per minute per token. Pull and push rate limits SHALL be shared per sync key across all principals (the browser and all agents share the same per-key buckets).

#### Scenario: Token authenticates on pull
- **WHEN** a client authenticates `GET /sync/pull` with a valid agent token
- **THEN** the server SHALL serve the pull for the token's sync key
- **AND** SHALL update the token's `last_seen` (subject to the throttle)

#### Scenario: Token authenticates on push
- **WHEN** a client authenticates `POST /sync/push` with a valid agent token
- **THEN** the server SHALL accept and process the push for the token's sync key (subject to the usual validation and rate limits)

#### Scenario: Token cannot mint a device pairing code
- **WHEN** a client authenticates `POST /sync/otp` with an agent token
- **THEN** the server SHALL respond with HTTP 401
- **AND** the server SHALL NOT create a pairing code (a device code redeems to the master key, so tokens SHALL never reach it)

#### Scenario: Token cannot register
- **WHEN** a client authenticates `POST /sync/register` with an agent token
- **THEN** the server SHALL respond with HTTP 401
- **AND** the server SHALL NOT create or touch any user row

#### Scenario: Token cannot mint, list, or revoke tokens
- **WHEN** a client authenticates `POST /sync/tokens`, `GET /sync/tokens`, or `DELETE /sync/tokens` with an agent token
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Revoked token is rejected
- **WHEN** a client authenticates with a token that has been revoked
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Rate limits are shared per sync key
- **WHEN** an agent token and the master key's browser both issue pull or push requests within the same window
- **THEN** both principals SHALL draw from the same per-sync-key pull/push rate-limit buckets

### Requirement: Agent token revocation and listing

The system SHALL provide a `DELETE /sync/tokens` endpoint (master-key auth) that revokes a token by its opaque identifier, and a `GET /sync/tokens` endpoint (master-key auth) that lists the sync key's tokens. The list SHALL return metadata only — never raw tokens: each entry SHALL include the opaque identifier, a display fingerprint, scope, creation time, and last-seen time. Revocation SHALL take effect immediately and SHALL NOT affect the master key, other tokens, or other devices.

#### Scenario: Revoke a token
- **WHEN** the master key calls `DELETE /sync/tokens` with a token's opaque identifier
- **THEN** the server SHALL revoke the token
- **AND** subsequent requests with that token SHALL fail with HTTP 401
- **AND** other tokens and the master key SHALL continue to work

#### Scenario: List tokens
- **WHEN** the master key calls `GET /sync/tokens`
- **THEN** the server SHALL respond with the sync key's token metadata (identifier, fingerprint, scope, created, last-seen)
- **AND** the response SHALL NOT contain any raw token values

#### Scenario: Token list with master key only
- **WHEN** an agent token calls `GET /sync/tokens` or `DELETE /sync/tokens`
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Fingerprints are stable and identical everywhere
- **WHEN** the server computes a token's fingerprint, the Settings UI displays it, or `siftctl status` prints it
- **THEN** all three SHALL derive it identically: SHA-256 of the token, first 20 bits of the digest rendered as 4 uppercase Crockford base32 characters (the same scheme the client uses for sync-key fingerprints)
- **AND** the derivation SHALL be covered by a fixed test vector

#### Scenario: Tokens survive key rotation as documented behavior
- **WHEN** the user rotates the sync key (regenerates)
- **THEN** tokens bound to the old key SHALL remain valid against the orphaned data they were minted for
- **AND** SHALL NOT be listed or revocable through the new key's Settings (documented limitation)

### Requirement: Agent pairing UI in Settings

The Settings drawer SHALL show an "Agents" row in the Sync section (only when sync is enabled) that opens a modal. The modal SHALL provide: a pair flow (button that mints a code, displays it with a countdown, and copies it), a list of active agents (fingerprint, last-seen, created), and revocation with a confirmation step. The UI SHALL NOT display or store raw tokens.

#### Scenario: Pair an agent
- **WHEN** the user opens the Agents modal and clicks the pair button
- **THEN** the modal SHALL display an 8-character code with an expiry countdown and a copy button
- **AND** the user SHALL be able to cancel without redeeming

#### Scenario: List and revoke agents
- **WHEN** the user opens the Agents modal with active tokens
- **THEN** the modal SHALL list each token's fingerprint, creation time, and last-seen time
- **AND** revoking SHALL require an explicit confirmation step
- **AND** after revocation the list SHALL reflect the revocation

#### Scenario: No agents paired
- **WHEN** the user opens the Agents modal and no tokens exist
- **THEN** the modal SHALL show an empty state with the pair action

### Requirement: OpenAPI document served at a stable URL

The system SHALL serve an OpenAPI document at `GET /openapi.json` describing the sync API: capabilities, register, otp, redeem, pull, push, and the agent token endpoints. The document SHALL declare `X-Sync-Key` as the API-key security scheme, SHALL describe the push payload with bare field values (no timestamps), SHALL describe the pull `since`/`serverTime` cursor, and SHALL mark the master-key-only endpoints (register, otp, tokens) so consumers know agent tokens cannot call them. The document SHALL be served without authentication from static assets and SHALL NOT expose the internal monotonic or rate-limit machinery.

#### Scenario: OpenAPI document is served
- **WHEN** a client requests `GET /openapi.json`
- **THEN** the server SHALL respond with HTTP 200 and a JSON OpenAPI document
- **AND** the document SHALL contain no timestamps in its push schema

#### Scenario: OpenAPI matches the API surface
- **WHEN** a consumer validates the served document against the live API
- **THEN** every documented endpoint SHALL exist with the documented method and security scheme
- **AND** the master-key-only endpoints SHALL be identifiable as such in the document
