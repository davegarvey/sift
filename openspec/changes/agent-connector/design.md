## Context

Sift has no user accounts. A sync account is identified by a 22-character sync key held in each device's IndexedDB. Agent tokens already exist. They are minted by redeeming a five-minute pairing code, stored as SHA-256 hashes, limited to `GET /sync/pull` and `POST /sync/push`, and revocable from Settings.

The sync database holds:

- subscriptions (`feeds`)
- read and starred state (`flags`)
- per-feed reading statistics

When polling is enabled, the poll database holds seven days of items per subscribed feed: title, link, author, date, excerpt and HTML. The sync routes now run on Workers (D1) and on the self-hosted Node and Bun adapters (SQLite through a D1 shim).

The chat-agent path fails because it depends on the agent's sandbox fetching Sift URLs and on links opening in the PWA. Neither holds in general.

## Goals / Non-Goals

**Goals:**

- Any agent that follows MCP and OAuth conventions can connect by being given one URL.
- Approving an agent works when the user's only signed-in Sift is an installed PWA on a phone.
- The tool surface supports recommendation, feed discovery, summarisation and subscription management without the agent fetching anything itself.
- One supported route for chat agents. Obsolete routes are removed.

**Non-Goals:**

- No client-specific integrations, listings or app-store submissions.
- No server-side summarisation or LLM calls. The agent does the reasoning.
- No access to device-local data that is not synchronised (extracted full articles, detailed reading history).
- No user accounts, email login or passwords.
- No MCP prompts, resources or server-initiated notifications in this change.

## Decisions

### 1. Remote MCP over Streamable HTTP, stateless

`/mcp` accepts JSON-RPC over `POST` and answers each request in the response. It keeps no MCP session state and does not offer the optional server-to-client SSE stream (`GET /mcp` returns 405). The handler is mounted in `server/handle.ts` beside the sync routes, so Workers, Node and Bun all serve it whenever sync storage is configured.

The tool calls originate from the agent's host (for example a vendor's connector infrastructure, or a desktop client's own process), not from a code sandbox. That host-side origin is what fixes the reported failure.

Alternatives considered:

- **A better prompt for the GET-URL approach.** This cannot fix sandbox egress or the PWA link problem.
- **A stateful MCP session.** It would add storage and failure modes that this tool set does not need.

### 2. OAuth 2.1 following the MCP authorisation specification

Sift acts as both the protected resource and the authorisation server, on the same origin.

- An unauthenticated `/mcp` request returns `401` with `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`.
- `/.well-known/oauth-protected-resource` names the resource `<origin>/mcp`, the authorisation server `<origin>`, and the scopes `read` and `write`.
- `/.well-known/oauth-authorization-server` advertises:
  - `authorization_endpoint` `/oauth/authorize`
  - `token_endpoint` `/oauth/token`
  - `registration_endpoint` `/oauth/register`
  - `revocation_endpoint` `/oauth/revoke`
  - `code_challenge_methods_supported: ["S256"]`
  - `grant_types_supported: ["authorization_code", "refresh_token"]`
  - `token_endpoint_auth_methods_supported: ["none"]`
  - `client_id_metadata_document_supported: true`
- **Client identification.** If `client_id` is an HTTPS URL, Sift fetches it through the upstream fetch policy as a Client ID Metadata Document, validates that its `client_id` equals the URL, and caches it. Otherwise the client must have registered at `/oauth/register` (Dynamic Client Registration), which stores the name, redirect URIs and optional `client_uri`. Metadata documents are cached for 24 hours, and the consent screen shows the client's website host from `client_uri` when given. The token, registration, revocation and metadata endpoints send `Access-Control-Allow-Origin: *` without credentials, because browser-based clients call them. `/sync/*` and the consent and decision endpoints stay same-origin. Supporting both covers current clients without favouring one.
- **Redirect URIs.** These must match exactly. Loopback redirects (`http://127.0.0.1`, `http://localhost`) may use any port, as RFC 8252 allows for native clients.
- **Clients are public.** PKCE S256 is mandatory. The `resource` parameter, when present, must equal `<origin>/mcp` or a connection URL `<origin>/mcp/c/<id>`.

An OAuth library was considered. The Workers-specific providers do not run on the Node and Bun adapters. The protocol subset above is small, and the token storage already exists. A focused implementation with a thorough test suite is preferred. See open questions.

### 3. Consent: adding the agent is the authorisation

The primary user is someone whose signed-in Sift is an installed PWA, often in a browser that is not their default (for example, a Chrome PWA with Firefox as the system browser). OAuth consent pages open in whatever browser the agent's client chooses: the system default for desktop apps and CLIs, or an in-app browser tab for mobile apps. Neither shares IndexedDB with the PWA, so the consent page usually cannot see a sync key. On iOS, links never open a PWA, and Firefox on Android does not hand links off to apps by default. The design therefore has to carry the user's identity from the PWA to the consent page, rather than relying on links back into the app.

#### Primary: single-use connection URL

1. In the PWA, Settings → Agents → **Connect an agent** mints a connection ID bound to the sync key, single-use, with a ten-minute expiry. The PWA shows and copies `<origin>/mcp/c/<id>`.
2. The user pastes that URL into any MCP client as a custom connector or remote server. The client's unauthenticated request receives `401` with `resource_metadata` pointing at `/.well-known/oauth-protected-resource/mcp/c/<id>`. That document names `<origin>/mcp/c/<id>` as the resource and `<origin>/oauth/c/<id>` as the authorisation server. The authorisation-server metadata at `/.well-known/oauth-authorization-server/oauth/c/<id>` advertises endpoints that carry the connection ID. Sift therefore recovers the ID during authorisation whether or not the client sends the `resource` parameter.
3. The consent page, in any browser, resolves the connection ID to the account and shows "Connect *client name* to your Sift?", the time the link was created, and one **Allow** button. Allow consumes the connection ID and completes the authorisation.
4. After use, `/mcp/c/<id>` remains a working alias of `/mcp`, because clients store the URL in their configuration. Access is governed by the token, and the spent ID has no further effect.

The connection URL is a bearer secret for its ten-minute life. That is the same exposure as the existing pairing code. It is limited by single use, the required tap on the consent page, and the new agent appearing in the PWA's connected-agents list with Revoke.

#### Endpoint scheme and decision API

The per-connection authorisation server's issuer is `<origin>/oauth/c/<id>`. Its endpoints are the origin-level paths with the ID inserted: `<origin>/oauth/c/<id>/authorize`, `/token`, `/register` and `/revoke`. The origin-level endpoints (`/oauth/authorize` and so on) remain, serve the same handlers, and recover the ID from `resource=<origin>/mcp/c/<id>` instead. Connection IDs are 192-bit URL-safe strings (32 characters). A `resource` that names a different connection from the path is refused with `invalid_target`.

After validation, `GET /oauth/authorize` stores the request and redirects to the SPA route `/connect?request=<request_id>`. The request ID is a 256-bit secret. The server adds `frame-ancestors 'none'` to `/connect` responses.

The consent page and the app use JSON endpoints:

- `GET /oauth/requests/:id` (unauthenticated; the request ID is the secret) returns the client name, whether it is unverified, the client website host, the redirect host, scopes, expiry, status, whether a usable connection ID is attached, and, while pending, the approval code. After a decision made in the app, the first poll also returns the finished redirect URL, once.
- `POST /oauth/requests/:id/decision` takes `{ "decision": "approve" | "deny" }`. It is authenticated by `X-Sync-Key` (master key) when that header is present, and otherwise by the request's usable connection ID, which an approval consumes and a denial leaves unused. It returns `{ "redirect": "<redirect_uri>?code=...&state=..." }`.
- `GET /oauth/approvals/:code` and `POST /oauth/approvals/:code/decision` (master key) serve the app's *Approve a connection* screen. The app never receives the authorisation code. Lookups are rate-limited per IP and per sync key.

Authorisation codes are stored hashed with a 60-second life. For a decision made in the app, the finished redirect (which contains the code) is held on the request row until the consent page collects it once, and is then cleared.

#### Fallbacks

These apply when the connection ID is absent, expired or spent (for example, a client reconnecting after losing its token):

- **Same browser.** If the consent page's IndexedDB holds a sync key, Allow posts the decision with `X-Sync-Key`.
- **Approval code.** The consent page shows an 8-character code with a copy button, and a QR code for approval from another device. In the PWA, Settings → Agents → *Approve a connection* accepts a pasted or typed code, or a QR scan. It shows the client name and redirect host before approval. The consent page polls the request status every two seconds and redirects once a decision is made.

#### Common rules

- **Full access by default.** The consent screen offers a single Allow that grants every scope the client requested. If the client requests no scope, the grant is `read write`. There are no per-scope checkboxes. The screen states plainly that the agent can read subscriptions, statistics and articles, and can change subscriptions and reading state. Clients that request only `read` receive only `read`.
- **Identity on the screen.** The screen shows the client's name, marked "unverified" when the name is self-asserted through registration, and the redirect host.
- **Hardening.** The consent page sends `Content-Security-Policy: frame-ancestors 'none'`. Decisions authenticated by sync key use the custom header, which cannot be sent by a cross-site form.
- **Codes and denial.** On approval, Sift issues a one-time authorisation code with a 60-second expiry, bound to the client, redirect URI, PKCE challenge, scopes and sync key. A denial redirects with `error=access_denied`.
- **No sync key anywhere.** The screen explains that sync must be turned on in Sift first.

The approval-code fallback resembles device-code phishing. App-side display of the client name and redirect host, plus the ten-minute expiry, limits it.

Alternatives considered:

- **A suggestion inbox requiring per-change approval.** Rejected at the user's direction. The grant is the authorisation, and destructive tool hints let clients ask per call.
- **Per-scope or per-data-type consent choices,** for example article content as a separate scope. Rejected: the intended use is broad delegation, and each extra choice adds friction to every connection without protecting anything the user values.
- **Links back into the PWA** (`?approve=`, app links). These are unreliable across browsers, and impossible on iOS.
- **Magic links or email.** These need accounts.

### 4. Tokens: opaque, hashed, scoped, with rotating refresh

OAuth grants extend the existing `tokens` table rather than creating a parallel credential store. One migration adds:

- `origin` (`paired` | `oauth`)
- `client_id`
- `client_name`
- `scopes` (space-separated)
- `refresh_hash`
- `refresh_expires_at`
- `expires_at` (access token expiry)
- `family_id`
- `prev_refresh_hash` (the hash just replaced, so that presenting it again is detected as reuse)
- `label` (user-chosen display name)

An OAuth grant is one row: a refresh rotates `token_hash` and `refresh_hash` in place and keeps `token_id` and `family_id`, so the connected-agents list, per-token rate-limit buckets and `last_seen` stay stable across rotation.

Access tokens keep the existing opaque format and SHA-256 storage, with a one-hour lifetime. Refresh tokens expire after 365 days without use, on a sliding window, and rotate on every use. Reuse of a rotated refresh token revokes the whole family. The long idle limit is deliberate: a connection should survive ordinary gaps in use, so the user connects once. Rotation with reuse detection limits the value of a leaked refresh token, and the connected-agents list shows the last use, so stale grants can be revoked by hand.

Tokens from `siftctl pair` become `origin = paired`, `scopes = read write`, with no expiry, which matches current behaviour.

Authentication accepts `Authorization: Bearer <token>` as well as the existing `X-Sync-Key`. Scope enforcement:

- `read`: `GET /sync/pull`, `GET /sync/stats/pull`, `GET /sync/items`, and read-only tools
- `write`: additionally `POST /sync/push` and the write tools

Statistics writes, token management, registration and device codes remain master-key-only. Revoking a grant in Settings deletes its access and refresh tokens together.

Opaque tokens were chosen over JWTs because every request already performs a database lookup for revocation, so JWTs would add key management for no saving.

### 5. Tools

Every tool returns `structuredContent` that conforms to a declared `outputSchema`, plus a short text rendering for clients that ignore structured output. Feed URLs are never the primary handle. Tools use the synchronised `feedId`, and item IDs use the existing `<feedId>::<guid>` form shared with `siftctl`.

| Tool | Scope | Annotations | Purpose |
|---|---|---|---|
| `list_subscriptions` | read | read-only | Live feeds with `feedId`, title, site URL, redacted feed URL, tags, and the statistics summary (`totalSeen`, `readOnce`, `readRate`, `readIndex`, `backlog`), sortable by engagement. |
| `get_reading_stats` | read | read-only | The account summary and per-feed statistics, as `siftctl stats --json` returns them. |
| `list_items` | read | read-only | Recent polled items, filterable by `feedIds`, `tag`, `since`, `unread`, `starred` and `query` (case-insensitive substring over title and excerpt). Returns metadata, excerpt and flags, newest first, with cursor pagination. |
| `get_item` | read | read-only | One item's content converted from HTML to Markdown, truncated at `maxChars` (default 20,000) with a `truncated` flag and the original link. |
| `discover_feeds` | read | read-only, open-world | Given a site, page or feed URL, fetches it through the upstream policy, parses it as a feed or looks for alternate feed links, probes a bounded set of conventional paths (`/feed`, `/rss.xml`, `/atom.xml`, `/index.xml`, `/feed.xml`), and returns candidates with title, site URL, item count, newest date and up to three sample titles. It reports whether each candidate is already subscribed. |
| `subscribe` | write | idempotent | Subscribes to a feed URL (discovering it if given a page) with an optional title and tags. Returns the subscription. |
| `update_subscription` | write | idempotent | Sets the title and/or tags on a `feedId`. |
| `unsubscribe` | write | destructive, idempotent | Removes a `feedId`. |
| `set_item_state` | write | idempotent | Sets `read` and/or `starred` on up to 100 item IDs. |

When the poll database is absent, `list_items` and `get_item` are not listed, and the server `instructions` say that article content is unavailable on this deployment.

The `initialize` result carries `instructions`: a short description of Sift, the ID conventions, and guidance for the common workflows. For example: "To recommend feeds, call `list_subscriptions` sorted by engagement, then verify every suggestion with `discover_feeds` before proposing it." Clients surface this text to the model, so it is how the expected workflows become discoverable without client-specific integration.

Write tools call the same server-side merge used by `POST /sync/push`, factored into a shared function, so the effect matches a device sync.

### 6. Data exposure

Agents can read everything Sift synchronises, including article text. This is intended: the grant is broad delegation, and the consent screen says so.

Feed URLs can contain credentials for private feeds. Returning them would send those secrets to a third-party model, which is a security problem rather than a privacy preference. Every URL in tool output is therefore redacted:

- userinfo is removed
- query parameter values whose names match `/(token|key|secret|auth|pass|sig|session|code)/i` are replaced with `REDACTED`

`subscribe` accepts credentials the agent supplies. They are not echoed back.

Tool calls are never logged with arguments or URLs, which is consistent with the existing logging rules.

### 7. Rate limits

Agent requests draw from per-token buckets that are separate from the per-sync-key device buckets. A runaway agent therefore cannot starve the user's devices of sync. `discover_feeds` has its own tighter per-account bucket because it causes upstream fetches. The upstream origin governor applies as usual.

### 8. Onboarding UI

Settings → Sync → Agents becomes **Connect an agent**:

- **Connect an agent.** A primary button that mints a single-use connection URL (`<origin>/mcp/c/<id>`), copies it, and shows it with a ten-minute countdown. One line of client-neutral guidance: "Paste this into your agent as a custom connector or remote MCP server, then tap Allow." The plain `<origin>/mcp` URL is shown underneath for clients configured by hand, which then approve through a fallback.
- **Using a terminal or HTTP?** An expandable section with a `siftctl pair` code, the OpenAPI document and `llms.txt`.
- **Approve a connection.** A code field (paste or type) plus a scan button, for the fallback path.
- **Connected agents.** One row per grant: client name (or token fingerprint for paired tokens), scopes, created, last used, and Revoke.

`/llms.txt` is published as a static asset describing Sift, the MCP URL, the OAuth discovery URLs, the OpenAPI document and the scopes, so an agent pointed at the Sift origin can work out how to connect.

### 9. Removals

The following are deleted:

- `server/mcp.ts` and `server/relay.ts`
- `/api/events` and `/api/capabilities`
- `MCP_ENABLED`, and the client relay subscription in `src/state.tsx`
- `?intent=add` handling
- code authentication on `GET /sync/pull`
- the copied chat prompt

Existing paired tokens are migrated in place and continue to work. The openspec requirement "MCP handlers use context methods" is removed.

## Risks / Trade-offs

- **Hand-written OAuth carries implementation risk.** Mitigation: a narrow surface (public clients, PKCE only, two grants), conformance tests for every validation branch, and a security review before merge.
- **Leaked connection URL.** Anyone who obtains it within ten minutes could connect an agent. Mitigation: single use, a required tap on the consent page, and the connected-agents list with Revoke.
- **Approval-code phishing** on the fallback path. Mitigation: app-side display of the client name and redirect host, short expiry, and per-grant revocation.
- **Per-connection metadata paths.** Some clients may cache authorisation metadata per origin rather than per resource URL. Mitigation: the approval-code fallback still completes the flow, and testing with independent clients will show whether this occurs.
- **Client behaviour varies.** Some clients may support only Dynamic Client Registration, and others only metadata documents. Supporting both reduces this, but the release must still be tried with at least two independent clients.
- **Self-hosted issuers.** Behind a reverse proxy, the request origin may not equal the public origin. Mitigation: an optional `PUBLIC_URL` setting that, when set, defines the issuer and resource URLs.
- **Agents needing more history** than the seven-day poll window cannot see older content. This is a documented limitation.

## Migration Plan

1. Sync-database migration: add the OAuth tables (`oauth_clients`, `oauth_connections`, `oauth_requests`, `oauth_codes`) and the new `tokens` columns. Backfill existing tokens as `origin = 'paired'`, `scopes = 'read write'`.
2. Ship the server endpoints, consent route and new Agents screen together with the removals in one release. There is no dual-path period.
3. Rollback: revert the release. The added columns and tables are inert to the previous code.

## Open Questions

- Should a vetted OAuth provider library that runs on all three adapters be adopted instead of hand-writing the endpoints, if one exists with a compatible licence? Default: hand-write, unless the security review recommends otherwise.
- Should Android get an additional handoff into the installed PWA (for example a share target) for the fallback path? Deferred until the connection-URL flow has been tried on real devices.
