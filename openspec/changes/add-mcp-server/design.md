## Context

Sift is a browser-first RSS reader. All subscription data lives in IndexedDB in the browser. The Hono server is a stateless proxy (feed/article/image forwarding). There is no server-side database.

Adding MCP support means an external process (the AI agent) needs to read and write subscription data. Since the data lives in the browser, the server must act as a relay between the agent and the browser.

The MCP server is local-only (Node/Bun). The Cloudflare Workers deployment stays a pure stateless proxy with no MCP support.

## Goals / Non-Goals

**Goals:**
- AI agents can list, discover, add, remove, and read feeds via MCP tools
- Server has no database — browser's IndexedDB is the source of truth
- Zero new npm dependencies (no MCP SDK, no WebSocket library)
- Feature gated by `MCP_ENABLED` env var and checkbox in Settings UI
- Browser syncs data to server via SSE + HTTP POST, server pushes mutations to browser
- Tools are MCP-compatible with SSE transport (no stdio)

**Non-Goals:**
- Cloudflare Workers MCP support
- Auth/tokens (localhost-only)
- Item caching on server (always fetched fresh)
- Multiple browser tab coordination (last EventSource wins)
- MCP resource or prompt support (tools only)
- MCP SDK dependency

## Decisions

### D1: Transport — SSE + HTTP POST instead of WebSocket

SSE is unidirectional (server→client), so the browser also POSTs data to a server endpoint. This gives bidirectional communication without any dependency: browsers have native `EventSource` and `fetch`. No `ws` package, no runtime-specific WebSocket adapters, works identically on Node and Bun, and preserves the option to support Workers later.

The MCP agent uses the same pattern: SSE to receive responses, POST to send tool calls. This is the standard MCP SSE transport.

### D2: No MCP SDK

The MCP protocol subset for tools is small: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`. The JSON-RPC handler, SSE framing, and tool dispatch together are ~150 lines. No SDK dependency avoids framework integration issues (SSEServerTransport targets Express-style APIs, not Hono) and keeps the server lean.

### D3: In-memory cache instead of server-side database

The server keeps a `Map<string, Feed>` in memory. The browser sends the full feed list on EventSource connect and on any local change. Reads (list_feeds, get_feed) hit the cache directly. Writes (add_feed, remove_feed) are relayed to the browser via SSE and wait for an ack before responding to the MCP agent.

Cache staleness is acceptable because: (a) the browser always syncs on reconnect, (b) MCP mutations go through the browser, and (c) the cache is small (<50KB for typical usage).

### D4: No auth for v1

The MCP endpoint is only mounted on localhost when `MCP_ENABLED=true`. No network exposure. Auth adds complexity with negligible security benefit for a local-only personal tool. A token system can be added in a later change if needed.

### D5: Feature gate — env var + browser capability check

`MCP_ENABLED=true` controls whether the server mounts the MCP and relay routes. The browser calls `GET /api/capabilities` on boot and only shows the MCP toggle if `{mcp: true}`. This keeps the default lean — no extra routes, no memory allocated, no Settings section shown when MCP is disabled server-side.

### D6: Shared fetch utility

The existing proxy routes (`/feed`, `/article`, `/img`) in `handle.ts` have inline timeout + user-agent logic. The MCP tools also need to fetch upstream feeds (for `discover_feed` and `get_feed_items`). Extracting the fetch utility to `server/fetch.ts` avoids duplication and keeps the proxy privacy contract (no URL logging) in one place.

## Risks / Trade-offs

- **[Cache staleness]** If the browser tab is closed and the MCP agent calls `list_feeds`, the server returns stale data. → Acceptable for a personal tool; the cache is updated within seconds of the browser reconnecting.
- **[Browser disconnect for writes]** If the browser is not connected and the MCP agent calls `add_feed` or `remove_feed`, the operation times out after 10s and returns an error. → Mitigated by the Settings UI showing connection status.
- **[Multiple browser tabs]** If two tabs have MCP enabled, the last one to connect is the one the server talks to. Previous tabs' EventSources are stale but harmless. → Acceptable for v1; a pub/sub model could be added later.
- **[Server restart flushes cache]** After a server restart, the feed cache is empty until a browser reconnects and syncs. → Reads return empty array instead of stale data, which is safer than returning stale data.
- **[No MCP SDK means manual protocol maintenance]** If the MCP spec evolves (new handshake fields, new capability negotiation), we update the handler directly rather than bumping a dependency. → The tools subset is stable and narrow.
