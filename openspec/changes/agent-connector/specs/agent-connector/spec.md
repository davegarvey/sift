## ADDED Requirements

### Requirement: Remote MCP endpoint

The system SHALL serve a Model Context Protocol endpoint at `/mcp` using the Streamable HTTP transport on every server adapter that has sync storage configured. The endpoint SHALL be stateless: each `POST` carries one JSON-RPC message or batch and receives its response in the HTTP response. `GET /mcp` SHALL return HTTP 405. The `initialize` result SHALL include server `instructions` describing Sift, its identifier conventions, and the recommended tool sequences for feed recommendation, feed discovery, and summarising recent reading.

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

### Requirement: OAuth discovery metadata

The system SHALL serve `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414) without authentication. The protected-resource document SHALL name the resource `<origin>/mcp`, the authorisation server `<origin>`, and the scopes `read` and `write`. The authorisation-server document SHALL advertise:

- the authorisation, token, registration and revocation endpoints
- `S256` as the only code challenge method
- the `authorization_code` and `refresh_token` grants
- `none` as the token endpoint authentication method
- support for Client ID Metadata Documents

When `PUBLIC_URL` is configured, it SHALL replace the request origin in every advertised URL.

#### Scenario: Discovery from a 401
- **WHEN** a client follows the `resource_metadata` URL from a 401 and then the listed authorisation server's metadata
- **THEN** it SHALL obtain every endpoint needed to complete authorisation without further configuration

### Requirement: OAuth client identification

The system SHALL accept two forms of client identification:

- a `client_id` that is an HTTPS URL, resolved as a Client ID Metadata Document fetched through the upstream fetch policy, whose `client_id` field SHALL equal the URL
- a `client_id` issued by Dynamic Client Registration (RFC 7591) at `POST /oauth/register`

Registration SHALL accept only public clients (`token_endpoint_auth_method` of `none`) and SHALL require at least one redirect URI. Redirect URIs SHALL be HTTPS, or loopback HTTP (`127.0.0.1`, `[::1]`, `localhost`). Registration SHALL be rate-limited per client IP.

#### Scenario: Metadata document client
- **WHEN** an authorisation request uses an HTTPS `client_id` whose document lists the requested redirect URI
- **THEN** the server SHALL accept the client and use the document's `client_name` on the consent screen

#### Scenario: Metadata document mismatch
- **WHEN** the fetched document's `client_id` differs from the requested URL, or it does not list the redirect URI
- **THEN** the server SHALL refuse the request without redirecting to the supplied redirect URI

#### Scenario: Dynamic registration
- **WHEN** a client registers with a name and redirect URIs
- **THEN** the server SHALL return a `client_id` and store the client as public

### Requirement: Authorisation request validation

`GET /oauth/authorize` SHALL require `response_type=code`, a known client, a redirect URI that exactly matches a registered one (any port for loopback URIs), a `code_challenge` with `code_challenge_method=S256`, and `state`. When present, `resource` SHALL equal `<origin>/mcp`. Requested scopes SHALL be a subset of `read write`. If no scope is requested, `read` SHALL be assumed. Invalid client or redirect URI errors SHALL be shown on Sift's page and SHALL NOT redirect. Other errors SHALL redirect to the redirect URI with the OAuth error code and `state`. A valid request SHALL be stored as pending for ten minutes, and the consent screen SHALL be served.

#### Scenario: Missing PKCE
- **WHEN** an authorisation request omits `code_challenge`
- **THEN** the server SHALL redirect with `error=invalid_request`

#### Scenario: Unregistered redirect URI
- **WHEN** an authorisation request names a redirect URI not registered for the client
- **THEN** the server SHALL show an error page and SHALL NOT redirect

### Requirement: Consent screen

The consent screen SHALL show:

- the client's name, marked as unverified when it was self-asserted through registration
- the redirect URI's host
- the requested access, in plain language

`read` SHALL be described as access to subscriptions, reading statistics and recent article content. `write` SHALL be shown as a checkbox, ticked by default when requested, described as changing subscriptions and marking articles read or starred. The page SHALL send `Content-Security-Policy: frame-ancestors 'none'`. Denying SHALL redirect with `error=access_denied` and `state`.

#### Scenario: User declines write
- **WHEN** the client requested `read write` and the user unticks write before allowing
- **THEN** the issued grant SHALL carry only `read`

#### Scenario: Deny
- **WHEN** the user denies the request
- **THEN** the browser SHALL be redirected to the client with `error=access_denied` and the original `state`

### Requirement: Same-browser approval

When the consent page's local storage holds a sync key, the consent screen SHALL offer a single Allow action. That action SHALL submit the decision authenticated with the sync key in the `X-Sync-Key` header. The server SHALL then issue an authorisation code bound to that sync key.

#### Scenario: One-click approval
- **WHEN** a user with sync enabled in the same browser taps Allow
- **THEN** the browser SHALL be redirected to the client's redirect URI with `code` and `state`

### Requirement: Cross-device approval

The consent screen SHALL always display an 8-character approval code for the pending request, and a QR code encoding `<origin>/?approve=<code>`. The installed app SHALL accept the approval code by typed entry under Settings → Agents, by scanning the QR code, or by opening the QR URL. Before approving, the app SHALL show the client name, redirect host and requested scopes, including the write checkbox. Approval or denial from the app SHALL complete the pending request. The consent page SHALL poll the request status and SHALL redirect once it is decided. Approval codes SHALL be single-use and expire with the pending request.

#### Scenario: Approve from an installed PWA
- **WHEN** the consent page opens in a phone browser that has no sync key, and the user enters its code in the installed Sift app and approves
- **THEN** the consent page SHALL redirect to the client with an authorisation code bound to the app's sync key

#### Scenario: Expired approval code
- **WHEN** the user enters an approval code more than ten minutes after the request was created
- **THEN** the app SHALL report that the request has expired
- **AND** no grant SHALL be issued

#### Scenario: Sync not enabled
- **WHEN** the consent page has no sync key
- **THEN** the screen SHALL explain that approval requires Sift with sync turned on, and SHALL show the approval code

### Requirement: Token endpoint

`POST /oauth/token` SHALL support two grants:

- `authorization_code`, with `code_verifier`, `redirect_uri`, `client_id` and an optional `resource`
- `refresh_token`

Authorisation codes SHALL be single-use and expire after 60 seconds, and SHALL be bound to the client, redirect URI, PKCE challenge, scopes and sync key. Access tokens SHALL expire after one hour. Refresh tokens SHALL expire 30 days after their last use and SHALL rotate on every use. Presenting an already-rotated refresh token SHALL revoke every token in that grant. Token values SHALL be stored only as SHA-256 hashes.

#### Scenario: Code exchange
- **WHEN** a client exchanges a valid code with the matching verifier
- **THEN** the server SHALL return an access token, a refresh token, `token_type` `Bearer`, `expires_in` and the granted `scope`

#### Scenario: PKCE mismatch
- **WHEN** the verifier does not match the code's challenge
- **THEN** the server SHALL respond `invalid_grant` and SHALL invalidate the code

#### Scenario: Refresh token reuse
- **WHEN** a refresh token that has already been rotated is presented
- **THEN** the server SHALL respond `invalid_grant`
- **AND** SHALL revoke all access and refresh tokens of that grant

### Requirement: Agent tools

The MCP server SHALL provide these tools. Read-only tools require `read`; the others require `write`.

- `list_subscriptions`: read-only.
- `get_reading_stats`: read-only.
- `list_items`: read-only.
- `get_item`: read-only.
- `discover_feeds`: read-only, open-world.
- `subscribe`: idempotent.
- `update_subscription`: idempotent.
- `unsubscribe`: destructive and idempotent.
- `set_item_state`: idempotent.

Each tool SHALL declare an output schema and return conforming `structuredContent`, plus a text rendering. Feeds SHALL be identified by synchronised `feedId`, and items by `<feedId>::<guid>`. Write tools SHALL apply changes through the same merge logic as `POST /sync/push`. When the poll database is unavailable, `list_items` and `get_item` SHALL NOT be listed.

#### Scenario: Recommend from engagement
- **WHEN** an agent calls `list_subscriptions` with `sort: "engagement"`
- **THEN** each subscription SHALL include its tags and statistics summary, ordered by read index, with `null` indices last

#### Scenario: Summarise recent reading
- **WHEN** an agent calls `list_items` with `feedIds` and `since`, then `get_item` on results
- **THEN** it SHALL receive item metadata and flags, then Markdown content truncated at `maxChars` with a `truncated` indicator and the original link

#### Scenario: Discover a person's blog
- **WHEN** an agent calls `discover_feeds` with a website URL whose page advertises an alternate feed or serves one at a conventional path
- **THEN** the result SHALL list each candidate feed's URL, title, site URL, newest item date, up to three sample titles, and whether the account already subscribes to it

#### Scenario: Subscribe
- **WHEN** an agent with `write` calls `subscribe` with a feed URL and tags
- **THEN** the subscription SHALL be created with discovered title and site URL and the normalised tags
- **AND** subscribing again to the same URL SHALL return the existing subscription unchanged

#### Scenario: Read-only grant
- **WHEN** an agent holding only `read` lists tools or calls a write tool
- **THEN** write tools SHALL be absent from the list
- **AND** a direct call SHALL fail with an insufficient-scope error

### Requirement: Agent data exposure

Every URL returned by an agent tool SHALL have its userinfo removed, and SHALL have the values of query parameters whose names match `token`, `key`, `secret`, `auth`, `pass`, `sig`, `session` or `code` (case-insensitive substring) replaced with `REDACTED`. Tool arguments, results and URLs SHALL NOT be logged. Agent access SHALL be limited to synchronised data and polled items. Device-local data SHALL NOT be reachable.

#### Scenario: Private feed URL
- **WHEN** a subscription's feed URL is `https://user:pw@example.com/feed?token=abc&page=2`
- **THEN** `list_subscriptions` SHALL return `https://example.com/feed?token=REDACTED&page=2`

### Requirement: Agent rate limits

Requests authenticated with an OAuth access token SHALL draw from per-token rate-limit buckets that are separate from the per-sync-key buckets used by devices. `discover_feeds` SHALL additionally be limited per sync key. Exceeding a limit SHALL return a tool error that states the retry interval.

#### Scenario: Agent exhausts its budget
- **WHEN** an agent exceeds its per-token limit
- **THEN** its calls SHALL fail with a retry interval
- **AND** the user's devices SHALL continue to sync unaffected

### Requirement: Connect an agent screen

Settings → Sync → Agents SHALL show:

- the connection URL `<origin>/mcp` with a copy action, and client-neutral guidance to add it as a custom connector or remote MCP server
- an expandable section for HTTP or OpenAPI agents and for `siftctl`
- an Approve a connection entry that accepts a code or a QR scan
- a list of connected agents (client name or fingerprint, scopes, created, last used), each with a Revoke action that requires confirmation

#### Scenario: Copy connection URL
- **WHEN** the user taps copy beside the connection URL
- **THEN** `<origin>/mcp` SHALL be on the clipboard

#### Scenario: Revoke a connected agent
- **WHEN** the user confirms Revoke on an OAuth grant
- **THEN** the grant's access and refresh tokens SHALL stop working immediately

### Requirement: Agent connection discovery document

The system SHALL serve `/llms.txt` as a static asset describing Sift, the MCP endpoint, the OAuth metadata URLs, the OpenAPI document, the scopes, and the bearer header for HTTP use.

#### Scenario: Agent reads llms.txt
- **WHEN** an agent fetches `<origin>/llms.txt`
- **THEN** it SHALL find the MCP URL and how authorisation is obtained
