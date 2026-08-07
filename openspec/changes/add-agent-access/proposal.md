## Why

The sync API is already a complete, authenticated, multi-tenant remote API for the user's subscription state (feeds + read/starred flags, LWW-merged in D1). AI agents can be first-class principals in the sync group — reading feeds, recommending others, and adding/removing subscriptions — by treating the agent as just another sync device. This gives agent access without MCP (which stays a local-only feature), without new bindings, and without any of the relay/gateway machinery the hosted Worker can't support. Two small server additions (clean push protocol, scoped agent tokens) plus client-side tooling (a CLI, an OpenAPI spec) make the existing API consumable by agents — including third-party consumers like ChatGPT that only need a URL and a token.

## What Changes

- **`server/sync/routes.ts` — push protocol cleanup (BREAKING).** `/sync/push` payloads drop all per-field `at` timestamps; the server stamps every write with its own monotonic time (the batch time it already assigns). The browser client's clock-offset logic (`src/sync/push.ts`) is deleted. Merge semantics are unchanged — LWW by stamp, but the server is now the only clock in the system. Payloads still carrying `at` are rejected.
- **`server/sync/` — agent tokens.** New `tokens` table (new D1 migration), `POST /sync/tokens` (mint an 8-char pairing code, master-key auth, rate-limited), `POST /sync/tokens/redeem` (code → token), `GET /sync/tokens` (metadata list), `DELETE /sync/tokens` (revoke), and an auth-middleware branch that accepts agent tokens on an explicit route allowlist (`pull`/`push` only, master-key-only routes reject tokens). The master sync key never leaves the browser.
- **`siftctl` CLI — new npm package + repo script.** `pair <code>`, `status`, `feeds`, `feed add <url>`, `feed remove <url>`, `items <url>`, `mark read <id>` — a thin client over the sync API. Token stored locally (config file or env var). Published so non-cloners can `npm i -g siftctl` against hosted prod.
- **OpenAPI spec.** Static `openapi.json` served by the Worker at a stable URL (committed to `public/`, no server code). Documents the sync API with `X-Sync-Key` auth; the wire format contains no timestamps, so nothing subtle to get wrong. Enables "paste the URL into ChatGPT" workflows.
- **`src/components/` — Settings Agents UI.** One new row in the Sync group ("Agents") opening an `AgentsModal`: pair flow (8-char code + countdown + copy), active agent list (fingerprint, last-seen, created), and revoke with confirmation. The browser never sees raw agent tokens — only fingerprints.
- **`README.md`** — agent setup for both surfaces (CLI + OAS), a copy-paste agent prompt template, and loud credential warnings (an agent token grants read/write of subscriptions to whoever holds it; revoke it in Settings).
- **Delete the `add-local-mcp-gateway` direction** — already superseded and removed; the MCP relay stays untouched as the local-only feature

## Capabilities

### New Capabilities
- `agent-tokens`: Scoped, revocable agent credentials bound to a sync key — mint/redeem/revoke lifecycle, the pairing-code flow, auth middleware enforcement (tokens grant `rw` to push and pull), the served OpenAPI document at a stable URL, and the Settings Agents UI (pair code display, token list with fingerprints, revocation).
- `agent-cli`: The `siftctl` command-line interface — command surface, auth provisioning (`pair`), stable output contract (human + `--json`), and local token storage.

### Modified Capabilities
- `device-sync`: The `/sync/push` payload contract loses client-supplied per-field timestamps; the server stamps all writes with its monotonic time and rejects payloads carrying `at`.

## Impact

- Server: `push` validation/semantics change (breaking — old clients 400), new `tokens` table + three new routes + auth branch; no new bindings, D1 only
- Browser: `src/sync/push.ts` loses its clock-offset machinery; Settings drawer gains one row + `AgentsModal`
- New published npm package `siftctl` (and/or repo-local script); no new runtime dependencies in the app
- Worker: serves `openapi.json` from static assets; zero server-code change for that surface
- MCP server (`server/mcp.ts`, relay) unchanged — remains a local-only feature
