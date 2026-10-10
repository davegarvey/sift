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
- **Client identification.** If `client_id` is an HTTPS URL, Sift fetches it through the upstream fetch policy as a Client ID Metadata Document, validates that its `client_id` equals the URL, and caches it. Otherwise the client must have registered at `/oauth/register` (Dynamic Client Registration), which stores the name and redirect URIs. Supporting both covers current clients without favouring one.
- **Redirect URIs.** These must match exactly. Loopback redirects (`http://127.0.0.1`, `http://localhost`) may use any port, as RFC 8252 allows for native clients.
- **Clients are public.** PKCE S256 is mandatory. The `resource` parameter, when present, must equal `<origin>/mcp`.

An OAuth library was considered. The Workers-specific providers do not run on the Node and Bun adapters. The protocol subset above is small, and the token storage already exists. A focused implementation with a thorough test suite is preferred. See open questions.

### 3. Consent: adding the agent is the authorisation

`GET /oauth/authorize` validates the request server-side, stores it as a pending authorisation request with a ten-minute expiry, and serves the SPA's consent route with the request ID. The consent screen shows:

- the client's name and redirect host, with an "unverified" note when the name is self-asserted through registration
- the scopes: "Read your subscriptions, reading statistics and recent articles" (always), and "Change your subscriptions and mark articles read or starred" (a checkbox, ticked by default if the client requested `write`)

The user's identity is established in one of two ways:

- **Same browser.** If the consent page's IndexedDB holds a sync key, the user taps Allow. The page posts the decision with `X-Sync-Key`. The custom header prevents cross-site form submission, and the page sends `Content-Security-Policy: frame-ancestors 'none'` to prevent clickjacking.
- **Another device or app.** The consent page shows an 8-character approval code and a QR code encoding `<origin>/?approve=<code>`. In the installed Sift app, Settings → Agents → *Approve a connection* accepts the typed code or scans the QR code with the existing scanner. The app shows the client name, redirect host and scopes again before approval, so the decision is made where the user is signed in. The consent page polls the request status every two seconds and redirects to the client once the request is approved or denied.

On approval, Sift issues a one-time authorisation code (60-second expiry), bound to the client, redirect URI, PKCE challenge, scopes and sync key. It then redirects with `code` and `state`. A denial redirects with `error=access_denied`.

If no sync key is available anywhere, the consent screen explains that sync must be turned on in Sift first.

The approval-code path resembles device-code phishing: an attacker could start a flow and persuade a victim to enter the code. The app-side confirmation, which shows the client name and redirect host, plus the ten-minute expiry, limits this. It is the same trust decision as any OAuth consent.

Alternatives considered:

- **A suggestion inbox requiring per-change approval.** Rejected at the user's direction. The grant is the authorisation, and destructive tool hints let clients ask per call.
- **Magic links or email.** These need accounts.

### 4. Tokens: opaque, hashed, scoped, with rotating refresh

OAuth grants extend the existing `tokens` table rather than creating a parallel credential store. One migration adds:

- `origin` (`paired` | `oauth`)
- `client_id`
- `client_name`
- `scopes` (space-separated)
- `refresh_hash`
- `refresh_expires_at`
- `family_id`

Access tokens keep the existing opaque format and SHA-256 storage, with a one-hour lifetime. Refresh tokens last 30 days on a sliding window and rotate on every use. Reuse of a rotated refresh token revokes the whole family.

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

Agents can now read article text. This is new exposure, and the consent wording states it.

Feed URLs can contain credentials for private feeds, and returning them would send those credentials to a third-party model. Every URL in tool output is therefore redacted:

- userinfo is removed
- query parameter values whose names match `/(token|key|secret|auth|pass|sig|session|code)/i` are replaced with `REDACTED`

`subscribe` accepts credentials the agent supplies. They are not echoed back.

Tool calls are never logged with arguments or URLs, which is consistent with the existing logging rules.

### 7. Rate limits

Agent requests draw from per-token buckets that are separate from the per-sync-key device buckets. A runaway agent therefore cannot starve the user's devices of sync. `discover_feeds` has its own tighter per-account bucket because it causes upstream fetches. The upstream origin governor applies as usual.

### 8. Onboarding UI

Settings → Sync → Agents becomes **Connect an agent**:

- **Connection URL.** `<origin>/mcp` with a copy button and one line of client-neutral guidance: "Add this as a custom connector or remote MCP server in your agent, then approve it here." An expandable section gives the same URL for HTTP and OpenAPI agents and a `siftctl` line for terminals.
- **Approve a connection.** A code field plus a scan button.
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
- **Approval-code phishing.** Mitigation: app-side display of the client name and redirect host, short expiry, and per-grant revocation.
- **Client behaviour varies.** Some clients may support only Dynamic Client Registration, and others only metadata documents. Supporting both reduces this, but the release must still be tried with at least two independent clients.
- **Self-hosted issuers.** Behind a reverse proxy, the request origin may not equal the public origin. Mitigation: an optional `PUBLIC_URL` setting that, when set, defines the issuer and resource URLs.
- **Content exposure.** An agent with `read` sees seven days of article content. This is stated at consent and revocable at any time.
- **Agents needing more history** than the seven-day poll window cannot see older content. This is a documented limitation.

## Migration Plan

1. Sync-database migration: add the OAuth tables (`oauth_clients`, `oauth_requests`, `oauth_codes`) and the new `tokens` columns. Backfill existing tokens as `origin = 'paired'`, `scopes = 'read write'`.
2. Ship the server endpoints, consent route and new Agents screen together with the removals in one release. There is no dual-path period.
3. Rollback: revert the release. The added columns and tables are inert to the previous code.

## Open Questions

- Should a vetted OAuth provider library that runs on all three adapters be adopted instead of hand-writing the endpoints, if one exists with a compatible licence? Default: hand-write, unless the security review recommends otherwise.
- Should `write` be ticked by default on the consent screen when it is requested? Default: yes, matching the decision that adding the agent is the authorisation.
