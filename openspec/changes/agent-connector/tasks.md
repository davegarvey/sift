## 1. Storage and authentication

- [ ] 1.1 Add a sync-database migration for `oauth_clients`, `oauth_requests` (pending authorisation plus approval code) and `oauth_codes`, and the `tokens` columns `origin`, `client_id`, `client_name`, `scopes`, `refresh_hash`, `refresh_expires_at`, `expires_at` and `family_id`; backfill existing tokens as `paired` with `read write`
- [ ] 1.2 Extend `server/sync/auth.ts`: accept `Authorization: Bearer`, carry scopes on the principal, reject expired OAuth tokens, enforce `read`/`write` per route, and remove code authentication on pull
- [ ] 1.3 Add per-token rate-limit buckets for OAuth principals and a per-account `discover` bucket
- [ ] 1.4 Extend the scheduled cleanup to sweep expired OAuth requests, codes and refresh-expired grants

## 2. OAuth authorisation server

- [ ] 2.1 Serve `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, honouring `PUBLIC_URL`
- [ ] 2.2 Implement `POST /oauth/register` (public clients, redirect URI rules, IP rate limit)
- [ ] 2.3 Implement Client ID Metadata Document resolution through the upstream fetch policy, with caching
- [ ] 2.4 Implement `GET /oauth/authorize` validation and pending-request creation; serve the consent route
- [ ] 2.5 Implement decision endpoints: same-browser approve/deny (master key), app approve/deny by approval code (master key), request lookup by code, and status polling for the consent page
- [ ] 2.6 Implement `POST /oauth/token` for both grants, with PKCE verification, rotation and reuse detection; implement `POST /oauth/revoke`
- [ ] 2.7 Conformance tests for every validation branch, including redirect-URI mismatch, PKCE failure, code replay, refresh reuse, scope down-selection and expiry

## 3. MCP server and tools

- [ ] 3.1 Factor the `/sync/push` merge into a shared server function used by the route and the write tools
- [ ] 3.2 Add the stateless Streamable HTTP handler at `/mcp` with the 401 discovery header and server `instructions`
- [ ] 3.3 Implement `list_subscriptions` and `get_reading_stats` with URL redaction
- [ ] 3.4 Implement `list_items` and `get_item` over the poll database and flags, including HTML-to-Markdown conversion and truncation; omit them when polling is unavailable
- [ ] 3.5 Implement `discover_feeds` reusing `parseFeed`/`findAlternateFeeds` with bounded conventional-path probing
- [ ] 3.6 Implement `subscribe`, `update_subscription`, `unsubscribe` and `set_item_state` with annotations and scope checks
- [ ] 3.7 Tool tests: output-schema conformance, scope filtering, redaction, idempotency, and an end-to-end write that a device pull observes

## 4. Client

- [ ] 4.1 Build the consent route: client details, scope wording, write checkbox, same-browser Allow, approval code and QR, status polling, sync-not-enabled state, and `frame-ancestors 'none'`
- [ ] 4.2 Rewrite `AgentsModal.tsx` as Connect an agent: connection URL, HTTP/OpenAPI and `siftctl` section, Approve a connection (code entry and QR scan), and the connected-agents list with revoke
- [ ] 4.3 Handle `/?approve=<code>` by opening the approval confirmation
- [ ] 4.4 Component tests for consent and approval flows

## 5. Removals

- [ ] 5.1 Delete `server/mcp.ts`, `server/relay.ts`, `/api/events`, `/api/capabilities` and `MCP_ENABLED` handling in all adapters and `.env.example`
- [ ] 5.2 Remove the relay EventSource, `mcpNotifySync` and `?intent=add` handling from `src/state.tsx` and callers
- [ ] 5.3 Remove the copied chat prompt and code-on-pull client code; delete or update the affected tests

## 6. Documentation

- [ ] 6.1 Update `public/openapi.json` with the bearer scheme, per-operation scopes and the OAuth reference; remove code authentication
- [ ] 6.2 Add `public/llms.txt`
- [ ] 6.3 Rewrite the README agent sections (connecting an agent, scopes, data exposure, revocation, `PUBLIC_URL`, the seven-day content limit) and remove the MCP experimental limitation

## 7. Verification

- [ ] 7.1 Run `openspec validate agent-connector`, `npm run typecheck`, `npm run lint` and `npm test`
- [ ] 7.2 Run a security review of the OAuth and consent code before merge
- [ ] 7.3 Connect at least two independent MCP clients against a preview deployment, including approval from an installed PWA on a phone, and record the results in the PR
