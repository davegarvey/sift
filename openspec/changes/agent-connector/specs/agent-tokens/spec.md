## MODIFIED Requirements

### Requirement: Agent token authentication and scope enforcement

The system SHALL accept agent tokens either in the `Authorization: Bearer` header or in the `X-Sync-Key` header. Every token SHALL carry an origin (`paired` or `oauth`), scopes (`read`, `write`, or both) and, for OAuth tokens, an expiry.

- A token with `read` SHALL be permitted on `GET /sync/pull`, `GET /sync/stats/pull`, `GET /sync/items` and read-only MCP tools.
- A token with `write` SHALL additionally be permitted on `POST /sync/push` and write MCP tools.
- Every other route SHALL reject agent tokens with HTTP 401. This includes `POST /sync/stats/push`, `POST /sync/otp`, `POST /sync/register`, and all token and grant management.
- Expired OAuth access tokens SHALL be rejected with HTTP 401.
- `GET /sync/pull` SHALL NOT accept a pairing code as a credential.

The server SHALL record `last_seen` on authentication, throttled to once per minute per token. Devices and paired tokens SHALL share per-sync-key rate-limit buckets. OAuth-token requests SHALL use per-token buckets.

#### Scenario: Token authenticates on pull
- **WHEN** a client authenticates `GET /sync/pull` with a valid agent token holding `read`, in either header
- **THEN** the server SHALL serve the pull for the token's sync key
- **AND** SHALL update the token's `last_seen` (subject to the throttle)

#### Scenario: Token authenticates on push
- **WHEN** a client authenticates `POST /sync/push` with a valid agent token holding `write`
- **THEN** the server SHALL accept and process the push for the token's sync key (subject to the usual validation and rate limits)

#### Scenario: Bearer token on pull
- **WHEN** a client calls `GET /sync/pull` with `Authorization: Bearer <token>` holding `read`
- **THEN** the server SHALL serve the pull for the token's sync key

#### Scenario: Read-only token cannot push
- **WHEN** a token holding only `read` calls `POST /sync/push`
- **THEN** the server SHALL respond with HTTP 403

#### Scenario: Pairing code no longer reads
- **WHEN** a client calls `GET /sync/pull?code=<code>`
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Token cannot mint a device pairing code
- **WHEN** a client authenticates `POST /sync/otp` with an agent token
- **THEN** the server SHALL respond with HTTP 401

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
- **WHEN** a paired agent token and the master key's browser both issue pull or push requests within the same window
- **THEN** both principals SHALL draw from the same per-sync-key pull/push rate-limit buckets
- **AND** requests authenticated with an OAuth access token SHALL instead draw from that token's own buckets

#### Scenario: Expired OAuth access token is rejected
- **WHEN** a client authenticates with an expired OAuth access token
- **THEN** the server SHALL respond with HTTP 401

### Requirement: Agent token revocation and listing

The system SHALL provide `GET /sync/tokens` and `DELETE /sync/tokens`, both master-key-only. They list and revoke the sync key's agent grants, and `PATCH /sync/tokens` renames one. The list SHALL return metadata only: identifier, origin, label, client name and website host (for OAuth grants), whether the client is unverified, fingerprint, scopes, creation time and last-seen time. Revoking an OAuth grant SHALL invalidate its access and refresh tokens together, immediately, and SHALL NOT affect other grants or devices.

#### Scenario: Revoke a token
- **WHEN** the master key calls `DELETE /sync/tokens` with a token's opaque identifier
- **THEN** the server SHALL revoke the token
- **AND** subsequent requests with that token SHALL fail with HTTP 401
- **AND** other tokens and the master key SHALL continue to work

#### Scenario: List tokens
- **WHEN** the master key calls `GET /sync/tokens`
- **THEN** the server SHALL respond with the sync key's token metadata
- **AND** the response SHALL NOT contain any raw token values

#### Scenario: Token list with master key only
- **WHEN** an agent token calls `GET /sync/tokens` or `DELETE /sync/tokens`
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Tokens survive key rotation as documented behavior
- **WHEN** the user rotates the sync key (regenerates)
- **THEN** tokens bound to the old key SHALL remain valid against the orphaned data they were minted for
- **AND** SHALL NOT be listed or revocable through the new key's Settings (documented limitation)

#### Scenario: List grants
- **WHEN** the master key calls `GET /sync/tokens`
- **THEN** the response SHALL list paired tokens and OAuth grants with their metadata and no raw token values

#### Scenario: Revoke an OAuth grant
- **WHEN** the master key revokes an OAuth grant
- **THEN** its current access token and refresh token SHALL both fail on their next use

#### Scenario: Fingerprints are stable and identical everywhere
- **WHEN** the server computes a paired token's fingerprint, the Settings UI displays it, or `siftctl status` prints it
- **THEN** all three SHALL derive it identically: SHA-256 of the token, first 20 bits of the digest rendered as 4 uppercase Crockford base32 characters
- **AND** the derivation SHALL be covered by a fixed test vector

### Requirement: Agent pairing UI in Settings

Agent management in Settings SHALL be provided by the agent-connector "Connect an agent" screen. The screen SHALL NOT offer `siftctl` pairing codes, SHALL NOT display or store raw tokens, and SHALL NOT offer a copyable chat prompt. Existing paired tokens SHALL appear in its connected-agents list as "Paired token" until they are revoked.

#### Scenario: Pair an agent
- **WHEN** the user opens Settings → Agents
- **THEN** the screen SHALL offer Connect an agent, which mints and copies a single-use connection URL
- **AND** SHALL NOT show a chat prompt or a pairing code

#### Scenario: List and revoke agents
- **WHEN** the user opens the Agents screen with active grants or paired tokens
- **THEN** the screen SHALL list each one's identity, access level, connected time and last-used time
- **AND** revoking SHALL require an explicit confirmation step
- **AND** after revocation the list SHALL reflect the revocation

#### Scenario: No agents paired
- **WHEN** the user opens the Agents screen and no grants or tokens exist
- **THEN** the screen SHALL show Connect an agent and the approval entry, with no connected-agents list

### Requirement: OpenAPI document served at a stable URL

The system SHALL serve an OpenAPI document at `GET /openapi.json` describing the sync API. It SHALL declare two security schemes, `X-Sync-Key` (API key) and HTTP bearer, and SHALL state the scope each agent-accessible operation requires. It SHALL describe the push payload with bare field values (no timestamps) and the pull `since`/`serverTime` cursor, and SHALL mark master-key-only endpoints. It SHALL reference `/.well-known/oauth-authorization-server` for obtaining bearer tokens. It SHALL NOT document code authentication on pull.

#### Scenario: OpenAPI document is served
- **WHEN** a client requests `GET /openapi.json`
- **THEN** the server SHALL respond with HTTP 200 and a JSON OpenAPI document
- **AND** the document SHALL contain no timestamps in its push schema

#### Scenario: OpenAPI matches the API surface
- **WHEN** a consumer validates the served document against the live API
- **THEN** every documented endpoint SHALL exist with the documented method, security schemes and scope
