## MODIFIED Requirements

### Requirement: Agent token authentication and scope enforcement

The system SHALL accept agent access tokens issued by the OAuth token endpoint in the `Authorization: Bearer` header. Each token SHALL carry scopes (`read`, `write`, or both) and an expiry, and expired tokens SHALL be rejected with HTTP 401. `read` SHALL permit `GET /sync/pull`, `GET /sync/stats/pull`, `GET /sync/items` and read-only MCP tools. `write` SHALL additionally permit `POST /sync/push` and write MCP tools. A token lacking a route's scope SHALL receive HTTP 403.

#### Scenario: Token authenticates on pull
- **WHEN** a client authenticates `GET /sync/pull` with a valid bearer token holding `read`
- **THEN** the server SHALL serve the pull for the token's sync key
- **AND** SHALL update the token's `last_seen` (throttled to once per minute)

#### Scenario: Token authenticates on push
- **WHEN** a client authenticates `POST /sync/push` with a valid bearer token holding `write`
- **THEN** the server SHALL accept and process the push for the token's sync key (subject to the usual validation and rate limits)

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
- **WHEN** a client authenticates any token or grant management endpoint, or `POST /sync/stats/push`, with an agent token
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Revoked token is rejected
- **WHEN** a client authenticates with a token whose grant has been revoked
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Expired access token is rejected
- **WHEN** a client authenticates with an access token past its expiry
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Rate limits are shared per sync key
- **WHEN** an agent and the user's devices issue pull or push requests within the same window
- **THEN** the devices SHALL draw from the per-sync-key buckets
- **AND** the agent SHALL draw only from its own per-token buckets

### Requirement: Agent token revocation and listing

The system SHALL provide master-key-only `GET /sync/tokens` (list), `PATCH /sync/tokens` (set or clear a label) and `DELETE /sync/tokens` (revoke). The list SHALL return one row per grant with metadata only: identifier, label, client name, client website host, whether the client is unverified, fingerprint, scopes, creation time and last-seen time. Revocation SHALL invalidate the grant's access and refresh tokens immediately, without affecting other grants or devices.

#### Scenario: Revoke a token
- **WHEN** the master key calls `DELETE /sync/tokens` with a grant's identifier
- **THEN** the server SHALL revoke the grant
- **AND** its access and refresh tokens SHALL fail on their next use
- **AND** other grants and the master key SHALL continue to work

#### Scenario: List tokens
- **WHEN** the master key calls `GET /sync/tokens`
- **THEN** the server SHALL respond with one metadata row per grant
- **AND** the response SHALL NOT contain any raw token values

#### Scenario: Token list with master key only
- **WHEN** an agent token calls `GET /sync/tokens`, `PATCH /sync/tokens` or `DELETE /sync/tokens`
- **THEN** the server SHALL respond with HTTP 401

#### Scenario: Fingerprints are stable and identical everywhere
- **WHEN** the server computes a grant's fingerprint and the Settings UI displays it
- **THEN** both SHALL derive it identically: SHA-256 of the grant identifier, first 20 bits rendered as 4 uppercase Crockford base32 characters
- **AND** the derivation SHALL be covered by a fixed test vector

#### Scenario: Tokens survive key rotation as documented behavior
- **WHEN** the user rotates the sync key (regenerates)
- **THEN** every grant bound to the old key SHALL stop working
- **AND** SHALL NOT be listed or revocable through the new key's Settings

### Requirement: OpenAPI document served at a stable URL

The system SHALL serve an OpenAPI document at `GET /openapi.json` describing the sync API. It SHALL declare the `X-Sync-Key` API-key scheme for devices and the HTTP bearer scheme for agents, state the scope each agent-accessible operation requires, and reference `/.well-known/oauth-authorization-server` for obtaining bearer tokens. It SHALL describe push payloads without timestamps and the pull `since`/`serverTime` cursor, and SHALL NOT document agent pairing codes.

#### Scenario: OpenAPI document is served
- **WHEN** a client requests `GET /openapi.json`
- **THEN** the server SHALL respond with HTTP 200 and a JSON OpenAPI document
- **AND** the document SHALL contain no timestamps in its push schema

#### Scenario: OpenAPI matches the API surface
- **WHEN** a consumer validates the served document against the live API
- **THEN** every documented endpoint SHALL exist with the documented method, security schemes and scope

## REMOVED Requirements

### Requirement: Agent token minting

**Reason**: Agents obtain access through OAuth consent. Agent pairing codes existed for `siftctl` and hosted chat prompts, both of which are removed.

**Migration**: Existing agent pairing codes are deleted. Connect an agent through the MCP connector instead.

### Requirement: Agent token redemption

**Reason**: Without agent pairing codes there is nothing to redeem. Tokens are issued only by the OAuth token endpoint.

**Migration**: Existing paired tokens are deleted. Their holders reconnect through OAuth.

### Requirement: Agent pairing UI in Settings

**Reason**: Replaced by the agent-connector "Connect an agent" screen, which has no pairing code or terminal section.

**Migration**: None.
