## Why

Sift's subscription data lives in IndexedDB inside the browser — invisible to external tools. Adding an MCP (Model Context Protocol) server lets AI agents (Cursor, OpenCode, Claude Desktop) read and manage subscriptions: list feeds, discover new ones, subscribe/unsubscribe, and fetch feed items for summarization.

## What Changes

- **`server/mcp.ts`** — MCP protocol handler over SSE + HTTP POST. Handles JSON-RPC lifecycle (initialize, tools/list, tools/call). No MCP SDK dependency.
- **`server/relay.ts`** — Browser bridge: SSE endpoint (`GET /api/events`) for push notifications, HTTP handler (`POST /api/events`) for sync and acks. In-memory feed cache.
- **`server/fetch.ts`** — Shared upstream fetch utility extracted from `handle.ts` (timeout + user-agent logic). Used by both proxy routes and MCP tools.
- **`server/handle.ts`** — Mount `/mcp`, `/api/events`, `/api/capabilities` routes behind `MCP_ENABLED` env var.
- **`src/settings.ts`** + `src/db/types.ts` — Add `mcpEnabled: boolean` to `AppSettings`.
- **`src/state.tsx`** — On boot check `/api/capabilities`. On MCP toggle: open/close `EventSource("/api/events")`, send initial sync, post local changes, handle incoming `add-feed`/`remove-feed` events.
- **`src/components/SettingsDrawer.tsx`** — Add "MCP Server" section: toggle, endpoint display, copy config button.
- **`vite.config.ts`** — Add `/api` and `/mcp` routes to the dev middleware pass-through list.

No new npm dependencies. No MCP SDK. No WebSocket library. No database.

## Capabilities

### New Capabilities
- `mcp-server`: MCP protocol server that exposes subscription management tools to AI agents. Covers the MCP SSE endpoint, JSON-RPC handler, tool definitions (list_feeds, get_feed, discover_feed, add_feed, remove_feed, get_feed_items), browser relay for data access, in-memory cache, and the Settings UI toggle.

### Modified Capabilities
None.

## Impact

- Server gains three new route groups (`/mcp`, `/api/events`, `/api/capabilities`) gated behind `MCP_ENABLED` env var
- Server process holds in-memory feed cache (<50KB) when MCP is enabled
- Browser opens an EventSource connection when user toggles MCP on
- MCP tools that mutate subscriptions require the browser to be connected (10s timeout)
- Cloudflare Workers deployment unchanged (MCP is local-only)
