## 1. Storage and authentication

- [x] 1.1 Add a sync-database migration for `oauth_clients`, `oauth_connections` (single-use connection IDs), `oauth_requests` (pending authorisation plus approval code) and `oauth_codes`, and the `tokens` columns `origin`, `client_id`, `client_name`, `scopes`, `refresh_hash`, `refresh_expires_at`, `expires_at` and `family_id`; backfill existing tokens as `paired` with `read write`
- [x] 1.2 Extend `server/sync/auth.ts`: accept `Authorization: Bearer`, carry scopes on the principal, reject expired OAuth tokens, enforce `read`/`write` per route, and remove code authentication on pull
- [x] 1.3 Add per-token rate-limit buckets for OAuth principals and a per-account `discover` bucket
- [x] 1.4 Extend the scheduled cleanup to sweep expired OAuth requests, codes and refresh-expired grants

## 2. OAuth authorisation server

- [x] 2.1 Serve `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, honouring `PUBLIC_URL`, including the per-connection variants under `/mcp/c/<id>` and `/oauth/c/<id>`
- [x] 2.1a Add the master-key endpoint that mints connection IDs (the `/mcp/c/<id>` alias is routed with the MCP handler in 3.2)
- [x] 2.2 Implement `POST /oauth/register` (public clients, redirect URI rules, IP rate limit)
- [x] 2.3 Implement Client ID Metadata Document resolution through the upstream fetch policy, with caching
- [x] 2.4 Implement `GET /oauth/authorize` validation and pending-request creation; serve the consent route
- [x] 2.5 Implement decision endpoints: connection-ID approve/deny (consumes the ID), same-browser approve/deny (master key), app approve/deny by approval code (master key), request lookup by code, and status polling for the consent page
- [x] 2.6 Implement `POST /oauth/token` for both grants, with PKCE verification, rotation and reuse detection; implement `POST /oauth/revoke`
- [x] 2.7 Conformance tests for every validation branch, including redirect-URI mismatch, PKCE failure, code replay, refresh reuse, scope down-selection and expiry

## 3. MCP server and tools

- [x] 3.1 Factor the `/sync/push` merge into a shared server function used by the route and the write tools
- [x] 3.2 Add the stateless Streamable HTTP handler at `/mcp` with the 401 discovery header and server `instructions`
- [x] 3.3 Implement `list_subscriptions` and `get_reading_stats` with URL redaction
- [x] 3.4 Implement `list_items` and `get_item` over the poll database and flags, including HTML-to-Markdown conversion and truncation; omit them when polling is unavailable
- [x] 3.5 Implement `discover_feeds` reusing `parseFeed`/`findAlternateFeeds` with bounded conventional-path probing
- [x] 3.6 Implement `subscribe`, `update_subscription`, `unsubscribe` and `set_item_state` with annotations and scope checks
- [x] 3.7 Tool tests: output-schema conformance, scope filtering, redaction, idempotency, and an end-to-end write that a device pull observes

## 4. Client

- [x] 4.1 Build the consent route: client details, full-access wording, single Allow for connection-ID and same-browser approval, fallback approval code with copy and QR, status polling, sync-not-enabled state, and `frame-ancestors 'none'`
- [x] 4.2 Rewrite `AgentsModal.tsx` as Connect an agent: mint-and-copy connection URL with countdown, approval-code entry behind a "Have an approval code?" link (no plain `/mcp` URL, HTTP, pairing or terminal section), and the connected-agents list with rename and revoke
- [x] 4.2a Show connected-agent identity (label, client name, website host, unverified mark, access, connected, last used) with Rename
- [x] 4.3 Component tests for consent and approval flows

## 5. Removals

- [x] 5.1 Delete `server/mcp.ts`, `server/relay.ts`, `/api/events`, `/api/capabilities` and `MCP_ENABLED` handling in all adapters and `.env.example`
- [x] 5.2 Remove the relay EventSource, `mcpNotifySync` and `?intent=add` handling from `src/state.tsx` and callers
- [x] 5.3 Remove the copied chat prompt and code-on-pull client code; delete or update the affected tests

## 6. Documentation

- [x] 6.1 Update `public/openapi.json` with the bearer scheme, per-operation scopes and the OAuth reference; remove code authentication
- [x] 6.2 Add `public/llms.txt`
- [x] 6.3 Rewrite the README agent sections (connecting an agent, scopes, data exposure, revocation, `PUBLIC_URL`, the seven-day content limit) and remove the MCP experimental limitation

## 7. Verification

- [ ] 7.1 Run `openspec validate agent-connector`, `npm run typecheck`, `npm run lint` and `npm test`
- [ ] 7.2 Run a security review of the OAuth and consent code before merge
- [ ] 7.3 Connect at least two independent MCP clients against a preview deployment, including connecting from a Chrome PWA whose system default browser is Firefox, and from an installed PWA on a phone, and record the results in the PR

## 8. Retire siftctl (after 7.3)

- [ ] 8.1 Delete `packages/siftctl`, `tests/siftctl.test.ts`, and the siftctl steps in `.github/workflows/ci.yml` and `release.yml`; update the workspace `package.json` and lockfile
- [ ] 8.2 Remove `POST /sync/tokens` and `POST /sync/tokens/redeem`, agent pairing-code handling and the `paired` origin from the server and client; remove `GET /sync/status`, whose only caller is `siftctl status`; stop accepting agent tokens in `X-Sync-Key` (bearer only); derive fingerprints from the grant identifier
- [ ] 8.3 Add a migration deleting paired tokens and agent pairing codes and dropping `tokens.origin`; mirror it in `server/sync/schema.ts`
- [ ] 8.4 Remove `siftctl` from the README and `public/openapi.json`
- [ ] 8.5 Ask the user to run `npm deprecate siftctl "Use the Sift MCP connector: <origin>/mcp"` from their npm account
