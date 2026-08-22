## 1. Server fetch utility

- [x] 1.1 Extract upstream fetch logic from `server/handle.ts` into `server/fetch.ts` (timeout, User-Agent, `getUpstreamUrl`, `assertNoUrlLog`, `badRequest`, `badGateway`)
- [x] 1.2 Update `server/handle.ts` to import from `./fetch.ts` instead of defining inline

## 2. MCP protocol handler

- [x] 2.1 Implement SSE endpoint handler (`GET /mcp`) in `server/mcp.ts` — creates SSE stream, sends `endpoint` event
- [x] 2.2 Implement JSON-RPC message handler (`POST /mcp`) — parse message body, route to handler by method
- [x] 2.3 Implement `initialize` method handler — validate protocol version, return capabilities (tools only)
- [x] 2.4 Implement `notifications/initialized` handler — no-op
- [x] 2.5 Implement `tools/list` handler — return tool definitions for all 6 tools
- [x] 2.6 Implement `tools/call` dispatcher — route to the correct tool function by name

## 3. Tool implementations

- [x] 3.1 Implement `list_feeds` tool — read from in-memory cache
- [x] 3.2 Implement `get_feed` tool — lookup feed by URL in cache
- [x] 3.3 Implement `discover_feed` tool — HTTP fetch URL, parse as feed, if that fails fetch HTML and scan for alternate links
- [x] 3.4 Implement `add_feed` tool — discover feed, relay to browser via relay, wait for ack
- [x] 3.5 Implement `remove_feed` tool — relay unsubscription to browser via relay, wait for ack
- [x] 3.6 Implement `get_feed_items` tool — HTTP fetch feed URL, parse, return items with optional limit

## 4. Browser relay

- [x] 4.1 Implement SSE endpoint (`GET /api/events`) in `server/relay.ts` — manage browser connections, send events
- [x] 4.2 Implement POST handler (`POST /api/events`) — accept sync data and ack messages
- [x] 4.3 Implement in-memory feed cache (`Map<string, Feed>`) with sync/update/delete methods
- [x] 4.4 Implement pending query tracker — map of query IDs to resolve/reject callbacks with 10s timeout
- [x] 4.5 Implement relay-to-MCP gateway — when browser sends ack, resolve the corresponding pending MCP call

## 5. Route wiring

- [x] 5.1 Register `/mcp`, `/api/events`, `/api/capabilities` routes in `server/handle.ts` behind `MCP_ENABLED` env var
- [x] 5.2 Add `/api` and `/mcp` to the Vite dev middleware pass-through list in `vite.config.ts`

## 6. MCP Server adapter wiring

- [x] 6.1 In `server/node.ts`, read `MCP_ENABLED` and pass to `createApp`
- [x] 6.2 In `server/bun.ts`, read `MCP_ENABLED` and pass to `createApp`

## 7. Settings + state changes (browser)

- [x] 7.1 Add `mcpEnabled: boolean` to `AppSettings` interface and `DEFAULT_SETTINGS` in `src/db/types.ts` and `src/settings.ts`
- [x] 7.2 Add MCP section to `SettingsDrawer.tsx` with toggle, endpoint URL display, and "Copy MCP Config" button
- [x] 7.3 On boot, call `GET /api/capabilities` and store whether MCP is available
- [x] 7.4 In `state.tsx`, when MCP toggle turns on: open EventSource, send initial sync, handle incoming events
- [x] 7.5 In `state.tsx`, when MCP toggle turns off: close EventSource, stop syncing
- [x] 7.6 In `state.tsx`, handle `add-feed` SSE events: call `upsertFeed()` in IndexedDB
- [x] 7.7 In `state.tsx`, handle `remove-feed` SSE events: call `unsubscribeFeed()` in IndexedDB
- [x] 7.8 After any local feed add/remove, if EventSource is active, POST updated feed list to `/api/events`

## 8. Verification

- [x] 8.1 Start server with `MCP_ENABLED=true`, verify `/api/capabilities` returns `{"mcp":true}`
- [ ] 8.2 Connect browser, enable MCP in Settings, verify EventSource opens and sync is sent
- [ ] 8.3 Connect an MCP client (e.g., OpenCode) to `http://localhost:8787/mcp`, verify tool list is advertised
- [ ] 8.4 Test `list_feeds` returns feeds from IndexedDB
- [ ] 8.5 Test `discover_feed` with a known feed URL
- [ ] 8.6 Test `add_feed` — verify feed appears in browser's IndexedDB and sidebar
- [ ] 8.7 Test `remove_feed` — verify feed is removed from browser
- [ ] 8.8 Test `get_feed_items` — verify items are returned
- [x] 8.9 Test MCP disabled (no env var): verify routes are not mounted
- [x] 8.10 Run `npm run typecheck` and `npm run lint` with zero errors
