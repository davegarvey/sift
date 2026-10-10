## ADDED Requirements

### Requirement: Remote MCP endpoint

The system SHALL serve a stateless Model Context Protocol endpoint at `/mcp`, using the Streamable HTTP transport, on every server adapter with sync storage configured. Each `POST` SHALL receive its JSON-RPC response in the HTTP response. `GET /mcp` SHALL return HTTP 405. Write tools SHALL take effect without any Sift browser tab open.

#### Scenario: Authenticated tool listing
- **WHEN** a client sends `tools/list` to `/mcp` with a valid bearer access token
- **THEN** the server SHALL return the tools permitted by the token's scopes, each with an input schema, output schema and annotations

#### Scenario: Unauthenticated request
- **WHEN** a client sends any request to `/mcp` without a valid bearer token
- **THEN** the server SHALL respond with HTTP 401
- **AND** SHALL include `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`

#### Scenario: No browser tab required
- **WHEN** an agent calls a write tool while no Sift browser tab is open
- **THEN** the change SHALL be applied to the sync database
- **AND** every synced device SHALL receive it on its next pull

### Requirement: MCP server instructions

The `initialize` result SHALL include `instructions` that describe Sift, its identifier conventions, and the recommended tool sequences for recommending feeds, discovering a site's feed, and summarising recent reading.

#### Scenario: Instructions guide discovery
- **WHEN** a client initialises a session
- **THEN** the instructions SHALL tell the agent to verify candidate feeds with `discover_feeds` before proposing or subscribing to them

### Requirement: OAuth protected-resource metadata

The system SHALL serve RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource` without authentication. It SHALL name the resource `<origin>/mcp`, the authorisation server `<origin>`, and the scopes `read` and `write`. When `PUBLIC_URL` is configured, it SHALL replace the request origin in every advertised URL.

#### Scenario: Discovery from a 401
- **WHEN** a client follows the `resource_metadata` URL from a 401
- **THEN** it SHALL find the resource identifier, the authorisation server and the supported scopes

### Requirement: OAuth authorisation-server metadata

The system SHALL serve RFC 8414 metadata at `/.well-known/oauth-authorization-server` without authentication. It SHALL advertise the authorisation, token, registration and revocation endpoints, `S256` as the only code challenge method, the `authorization_code` and `refresh_token` grants, `none` as the token endpoint authentication method, and support for Client ID Metadata Documents.

#### Scenario: Complete discovery
- **WHEN** a client reads the authorisation-server metadata
- **THEN** it SHALL obtain every endpoint needed to complete authorisation without further configuration

### Requirement: Client ID Metadata Documents

The system SHALL accept a `client_id` that is an HTTPS URL by fetching it, through the upstream fetch policy, as a Client ID Metadata Document. The document's `client_id` field SHALL equal the URL, and the document SHALL list the requested redirect URI.

#### Scenario: Metadata document client
- **WHEN** an authorisation request uses an HTTPS `client_id` whose document lists the requested redirect URI
- **THEN** the server SHALL accept the client and use the document's `client_name` on the consent screen

#### Scenario: Metadata document mismatch
- **WHEN** the fetched document's `client_id` differs from the requested URL, or it does not list the redirect URI
- **THEN** the server SHALL refuse the request without redirecting to the supplied redirect URI

### Requirement: Dynamic client registration

The system SHALL provide RFC 7591 registration at `POST /oauth/register`. It SHALL accept only public clients (`token_endpoint_auth_method` of `none`), SHALL require at least one redirect URI, and SHALL accept only HTTPS or loopback HTTP (`127.0.0.1`, `[::1]`, `localhost`) redirect URIs. Registration SHALL be rate-limited per client IP.

#### Scenario: Dynamic registration
- **WHEN** a client registers with a name and redirect URIs
- **THEN** the server SHALL return a `client_id` and store the client as public

#### Scenario: Non-HTTPS redirect refused
- **WHEN** a client registers a plain HTTP redirect URI that is not loopback
- **THEN** the server SHALL respond with `invalid_redirect_uri`

### Requirement: Authorisation request validation

`GET /oauth/authorize` SHALL require `response_type=code`, a known client, an exactly matching redirect URI (any port for loopback), an S256 `code_challenge` and `state`. A present `resource` SHALL equal `<origin>/mcp` or a connection URL. Scopes SHALL be a subset of `read write`, defaulting to both. Client and redirect URI errors SHALL be shown on Sift's page without redirecting. Other errors SHALL redirect with the OAuth error and `state`.

#### Scenario: Missing PKCE
- **WHEN** an authorisation request omits `code_challenge`
- **THEN** the server SHALL redirect with `error=invalid_request`

#### Scenario: Unregistered redirect URI
- **WHEN** an authorisation request names a redirect URI not registered for the client
- **THEN** the server SHALL show an error page and SHALL NOT redirect

#### Scenario: Valid request
- **WHEN** an authorisation request passes validation
- **THEN** the server SHALL store it as pending for ten minutes and serve the consent screen

### Requirement: Single-use connection URLs

The installed app SHALL be able to mint, using the master sync key, a connection ID that is bound to the sync key, single-use and valid for ten minutes. The app SHALL present the ID as `<origin>/mcp/c/<id>`. That path SHALL behave as `/mcp` for all MCP traffic, both before and after the ID is used.

#### Scenario: Mint a connection URL
- **WHEN** the user taps Connect an agent
- **THEN** the app SHALL copy `<origin>/mcp/c/<id>` to the clipboard and show a ten-minute countdown

#### Scenario: Spent URL still serves MCP
- **WHEN** a client holding a valid access token calls `<origin>/mcp/c/<id>` after the ID has been used
- **THEN** the server SHALL serve the request exactly as `/mcp` would

### Requirement: Connection ID recovery during authorisation

An unauthenticated request to `/mcp/c/<id>` SHALL return 401 with `resource_metadata` pointing to `/.well-known/oauth-protected-resource/mcp/c/<id>`. That document SHALL name the resource `<origin>/mcp/c/<id>` and the authorisation server `<origin>/oauth/c/<id>`, whose RFC 8414 metadata advertises endpoints carrying the ID. The server SHALL recover the ID from those endpoints or from the `resource` parameter.

#### Scenario: Client omits resource
- **WHEN** a client authorises through the per-connection metadata without sending a `resource` parameter
- **THEN** the consent screen SHALL still resolve the connection ID to its account

#### Scenario: Client sends resource only
- **WHEN** a client uses the origin-level endpoints but sends `resource=<origin>/mcp/c/<id>`
- **THEN** the consent screen SHALL resolve the connection ID to its account

### Requirement: Connection URL consent

When the authorisation request carries an unexpired, unused connection ID, the consent screen SHALL identify the account without a sync key in the browser. It SHALL show the client name and redirect host, the time the URL was created, and a single Allow action. Allow SHALL consume the ID and issue the authorisation code. Deny SHALL leave the ID unused until expiry.

#### Scenario: Connect from a PWA in a non-default browser
- **WHEN** the user copies a connection URL from a Chrome PWA, pastes it into an agent, and the agent opens the consent page in Firefox
- **THEN** one tap on Allow SHALL return the browser to the client with an authorisation code bound to the PWA's sync key

#### Scenario: Reused connection URL
- **WHEN** a second authorisation request carries a connection ID that has already been consumed
- **THEN** the consent screen SHALL use the fallback approval paths

### Requirement: Full-access consent

The consent screen SHALL offer one Allow action that grants every scope the client requested, with no per-scope or per-data choices. It SHALL state that the agent can read subscriptions, reading statistics and articles, and can change subscriptions and reading state (wording limited to the scopes granted). The client name SHALL be marked unverified when it comes from registration. The page SHALL send `Content-Security-Policy: frame-ancestors 'none'`.

#### Scenario: Default grant
- **WHEN** a client requests no scope and the user taps Allow
- **THEN** the grant SHALL carry `read write`

#### Scenario: Client requests read only
- **WHEN** a client requests only `read`
- **THEN** the consent wording SHALL describe read access only
- **AND** the grant SHALL carry only `read`

#### Scenario: Deny
- **WHEN** the user denies the request
- **THEN** the browser SHALL be redirected to the client with `error=access_denied` and the original `state`

### Requirement: Same-browser approval fallback

When the consent request has no usable connection ID and the consent page's local storage holds a sync key, Allow SHALL submit the decision authenticated with that key in the `X-Sync-Key` header.

#### Scenario: One-tap approval in the PWA's browser
- **WHEN** the consent page opens in the browser that holds the user's sync key and the user taps Allow
- **THEN** the browser SHALL be redirected to the client with `code` and `state`

### Requirement: Approval code fallback

When the consent request has no usable connection ID, the consent screen SHALL show an 8-character, single-use approval code with a copy action, and a QR code of it for the in-app scanner. Under Settings → Agents, the app SHALL accept a pasted, typed or scanned code. It SHALL show the client name, redirect host and scopes before approving. The consent page SHALL poll and redirect once a decision is made.

#### Scenario: Approve by pasted code
- **WHEN** the user copies the code from the consent page, pastes it into the installed app, and approves
- **THEN** the consent page SHALL redirect to the client with an authorisation code bound to the app's sync key

#### Scenario: Expired approval code
- **WHEN** the user enters an approval code more than ten minutes after the request was created
- **THEN** the app SHALL report that the request has expired
- **AND** no grant SHALL be issued

#### Scenario: Sync not enabled
- **WHEN** the consent page has no connection ID and no sync key
- **THEN** the screen SHALL explain that approval requires Sift with sync turned on, and SHALL show the approval code

### Requirement: Authorisation code exchange

`POST /oauth/token` SHALL support the `authorization_code` grant. Codes SHALL be single-use, expire after 60 seconds, and be bound to the client, redirect URI, PKCE challenge, scopes and sync key. A successful exchange SHALL return an access token valid for one hour, a refresh token, `token_type` `Bearer`, `expires_in` and `scope`. Token values SHALL be stored only as SHA-256 hashes.

#### Scenario: Code exchange
- **WHEN** a client exchanges a valid code with the matching verifier
- **THEN** the server SHALL return the access token, refresh token and granted scope

#### Scenario: PKCE mismatch
- **WHEN** the verifier does not match the code's challenge
- **THEN** the server SHALL respond `invalid_grant` and SHALL invalidate the code

### Requirement: Refresh token rotation

`POST /oauth/token` SHALL support the `refresh_token` grant. Refresh tokens SHALL expire 30 days after their last use and SHALL rotate on every use. Presenting an already-rotated refresh token SHALL revoke every token in that grant. `POST /oauth/revoke` SHALL revoke a presented access or refresh token.

#### Scenario: Refresh
- **WHEN** a client presents a current refresh token
- **THEN** the server SHALL return a new access token and a new refresh token, and SHALL invalidate the old refresh token

#### Scenario: Refresh token reuse
- **WHEN** a refresh token that has already been rotated is presented
- **THEN** the server SHALL respond `invalid_grant`
- **AND** SHALL revoke all access and refresh tokens of that grant

### Requirement: Agent read tools

The MCP server SHALL provide read-only tools requiring `read`:

- `list_subscriptions`
- `get_reading_stats`
- `list_items`
- `get_item`
- `discover_feeds` (also open-world)

Each SHALL declare an output schema and return conforming `structuredContent` plus a text rendering. Feeds SHALL be identified by `feedId`, and items by `<feedId>::<guid>`. Without a poll database, `list_items` and `get_item` SHALL NOT be listed.

#### Scenario: Recommend from engagement
- **WHEN** an agent calls `list_subscriptions` with `sort: "engagement"`
- **THEN** each subscription SHALL include its tags and statistics summary, ordered by read index, with `null` indices last

#### Scenario: Summarise recent reading
- **WHEN** an agent calls `list_items` with `feedIds` and `since`, then `get_item` on results
- **THEN** it SHALL receive item metadata and flags, then Markdown content truncated at `maxChars` with a `truncated` indicator and the original link

#### Scenario: Discover a person's blog
- **WHEN** an agent calls `discover_feeds` with a website URL whose page advertises an alternate feed or serves one at a conventional path
- **THEN** the result SHALL list each candidate's feed URL, title, site URL, newest item date, up to three sample titles, and whether the account already subscribes to it

### Requirement: Agent write tools

The MCP server SHALL provide write tools requiring `write`: `subscribe`, `update_subscription` and `set_item_state` (idempotent), and `unsubscribe` (destructive, idempotent). They SHALL apply changes through the same merge logic as `POST /sync/push`. A grant without `write` SHALL NOT list them, and SHALL receive an insufficient-scope error if it calls them.

#### Scenario: Subscribe
- **WHEN** an agent calls `subscribe` with a feed URL and tags
- **THEN** the subscription SHALL be created with the discovered title and site URL and the normalised tags
- **AND** subscribing again to the same URL SHALL return the existing subscription unchanged

#### Scenario: Read-only grant
- **WHEN** an agent holding only `read` calls `unsubscribe`
- **THEN** the call SHALL fail with an insufficient-scope error

### Requirement: Credential redaction in agent output

Every URL returned by an agent tool SHALL have its userinfo removed. Values of query parameters whose names contain `token`, `key`, `secret`, `auth`, `pass`, `sig`, `session` or `code` (case-insensitive) SHALL be replaced with `REDACTED`. Tool arguments, results and URLs SHALL NOT be logged.

#### Scenario: Private feed URL
- **WHEN** a subscription's feed URL is `https://user:pw@example.com/feed?token=abc&page=2`
- **THEN** `list_subscriptions` SHALL return `https://example.com/feed?token=REDACTED&page=2`

### Requirement: Agent rate limits

Requests authenticated with an OAuth access token SHALL draw from per-token rate-limit buckets, separate from the per-sync-key buckets used by devices. `discover_feeds` SHALL additionally be limited per sync key. Exceeding a limit SHALL return a tool error that states the retry interval.

#### Scenario: Agent exhausts its budget
- **WHEN** an agent exceeds its per-token limit
- **THEN** its calls SHALL fail with a retry interval
- **AND** the user's devices SHALL continue to sync unaffected

### Requirement: Connect an agent screen

Settings → Sync → Agents SHALL offer:

- Connect an agent, which mints and copies a connection URL, with client-neutral guidance
- the plain `<origin>/mcp` URL
- a terminal and HTTP section (`siftctl` pairing, OpenAPI, `llms.txt`)
- Approve a connection, accepting a code or a QR scan
- connected agents (name or fingerprint, scopes, created, last used), each with a confirmed Revoke

#### Scenario: Revoke a connected agent
- **WHEN** the user confirms Revoke on an OAuth grant
- **THEN** the grant's access and refresh tokens SHALL stop working immediately

#### Scenario: New connection appears
- **WHEN** an agent completes authorisation and the user reopens the Agents screen
- **THEN** the agent SHALL appear in the connected-agents list under its client name

### Requirement: Agent connection discovery document

The system SHALL serve `/llms.txt` as a static asset describing Sift, the MCP endpoint, the OAuth metadata URLs, the OpenAPI document, the scopes, and the bearer header for HTTP use.

#### Scenario: Agent reads llms.txt
- **WHEN** an agent fetches `<origin>/llms.txt`
- **THEN** it SHALL find the MCP URL and how authorisation is obtained
