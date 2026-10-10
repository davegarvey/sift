## Why

People increasingly manage their reading through a general-purpose agent: "what should I subscribe to, given what I already read?", "does this person have a blog I can follow?", "summarise this week's posts from the feeds I read most". Sift should support those requests from any reasonably capable agent, and connecting one should take seconds.

Today Sift offers four agent paths, and the two aimed at chat agents fail in ordinary use:

- **Copied prompt with `GET /sync/pull?code=`.** The agent must fetch a Sift URL from its own execution environment. Sandboxed agents (for example Codex, or ChatGPT's tool sandbox) block that request, so the agent cannot read anything. The code also expires after five minutes, which cuts off any task that runs longer.
- **`?intent=add` links for writes.** On a phone, the link opens in the system browser rather than the installed PWA. The browser has no sync key, so the add flow does not reach the user's subscriptions. iOS isolates PWA storage from Safari, so no link format fixes this.
- **Local MCP (`MCP_ENABLED`).** It runs only on a self-hosted server, writes through an SSE relay to an open browser tab, and is marked experimental.
- **`siftctl` and the OpenAPI document.** These work, but only for agents with a shell or OpenAPI support, and setup takes several manual steps.

The common fault is that each path makes the agent reach Sift through a channel the agent's host may not provide. Meanwhile, the server already holds what agents need: subscriptions, tags, read and starred flags, per-feed reading statistics, seven days of polled item content, and an upstream fetcher that can perform feed discovery on the agent's behalf.

## What Changes

- Add a **remote MCP server** at `/mcp` on every server adapter, using the MCP Streamable HTTP transport. It runs against the sync database, so it needs no open browser tab. Tool calls are made by the agent's host rather than its sandbox.
- Protect it with **OAuth 2.1, as specified by the MCP authorisation specification**: protected-resource metadata (RFC 9728), authorisation-server metadata (RFC 8414), authorisation code with PKCE (S256), resource indicators (RFC 8707), and both Client ID Metadata Documents and Dynamic Client Registration (RFC 7591) for client identification. No client-specific integration is built.
- Add a **consent page** where adding the agent is the authorisation. The user grants `read` and, optionally, `write`. Approval is one click in a browser that already holds the sync key. Otherwise, the user approves from the installed Sift app using a short code or QR code shown on the consent page, which covers the iOS PWA case.
- Expose **tools for the stated workflows**, each annotated with read-only, destructive and idempotent hints so clients can apply their own confirmation policy:
  - `list_subscriptions`
  - `get_reading_stats`
  - `list_items`
  - `get_item`
  - `discover_feeds`
  - `subscribe`
  - `update_subscription`
  - `unsubscribe`
  - `set_item_state`

  Writes go through the same merge path as device sync, so every device picks them up.
- Accept OAuth-issued tokens as `Authorization: Bearer` on the REST sync API, and publish `/llms.txt` describing how to connect. This covers agents that use OpenAPI or HTTP rather than MCP, with the same consent and scopes.
- Replace the Agents modal with a client-neutral **Connect an agent** screen: the MCP URL with a copy button, an "Approve a connection" code entry, and a list of connected agents showing the client name, scopes and last use, each with a revoke action.
- **BREAKING** (pre-production, forward-only): remove the copied chat prompt, code authentication on `GET /sync/pull`, `?intent=add` handling, the local MCP server, the `/api/events` SSE relay, `/api/capabilities` and `MCP_ENABLED`. `siftctl pair <code>` remains for terminal use.

## Capabilities

### New Capabilities

- `agent-connector`: the remote MCP server, its OAuth authorisation server and consent flow, tool surface, data exposure rules, and agent onboarding UI.

### Modified Capabilities

- `agent-tokens`: tokens gain an origin (paired or OAuth), a client name, scopes, and refresh-token rotation. Bearer authentication is added. Code authentication on pull is removed. The Settings UI is replaced by the agent-connector onboarding UI.
- `feed-service`: the MCP SSE relay requirement is removed.

## Impact

- Server: new `server/agent/` module (OAuth endpoints, MCP handler, tools); `server/handle.ts` wiring; `server/sync/auth.ts` principal and scope changes; `server/mcp.ts` and `server/relay.ts` deleted.
- Database: one sync-database migration for OAuth clients, authorisation requests and codes, and token scope/refresh columns.
- Client: `AgentsModal.tsx` rewritten; a new consent route; approval entry in the installed app; MCP relay listeners and intent handling removed from `src/state.tsx`.
- Documentation: README agent sections rewritten; `public/openapi.json` gains the bearer scheme; `public/llms.txt` added.
- Dependencies: the existing `@modelcontextprotocol/server` package; no OAuth library is required, but see the design's open questions.
