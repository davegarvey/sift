## ADDED Requirements

### Requirement: MCP protocol over SSE

The server SHALL expose an MCP-compatible endpoint at `/mcp` that supports SSE transport. The endpoint SHALL accept JSON-RPC 2.0 messages via HTTP POST and stream responses via Server-Sent Events. The server SHALL support the `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` methods.

#### Scenario: MCP handshake completes successfully
- **WHEN** an MCP client connects to `GET /mcp` and receives an SSE stream
- **THEN** the server SHALL send an `endpoint` event with a URL for POSTing JSON-RPC messages
- **WHEN** the client sends `POST /mcp` with body `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}`
- **THEN** the server SHALL respond via SSE with `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"sift-mcp","version":"0.1.0"}}}`
- **WHEN** the client sends `{"jsonrpc":"2.0","method":"notifications/initialized"}`
- **THEN** the server SHALL NOT send a response for this notification

#### Scenario: Tool list is advertised
- **WHEN** the client sends `POST /mcp` with body `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`
- **THEN** the server SHALL respond via SSE with a result containing a `tools` array with tool definitions for `list_feeds`, `get_feed`, `discover_feed`, `add_feed`, `remove_feed`, and `get_feed_items`, each with `name`, `description`, and `inputSchema` properties

### Requirement: list_feeds tool

The server SHALL provide a `list_feeds` tool that returns all subscribed feeds.

#### Scenario: list_feeds returns cached feeds
- **WHEN** the MCP client calls `tools/call` with name `list_feeds`
- **THEN** the server SHALL respond with a `content` array containing the full list of subscribed feeds from its in-memory cache
- **WHEN** the cache is empty (no browser has synced yet)
- **THEN** the server SHALL respond with an empty array (not an error)

### Requirement: get_feed tool

The server SHALL provide a `get_feed` tool that returns details of a specific feed by URL.

#### Scenario: get_feed returns a known feed
- **WHEN** the MCP client calls `tools/call` with name `get_feed` and arguments `{"url": "https://example.com/feed.xml"}`
- **AND** that feed exists in the server's in-memory cache
- **THEN** the server SHALL respond with the feed object

#### Scenario: get_feed returns null for unknown URL
- **WHEN** the MCP client calls `get_feed` with a URL not in the cache
- **THEN** the server SHALL respond with a text content containing an error message

### Requirement: discover_feed tool

The server SHALL provide a `discover_feed` tool that checks whether a URL is a valid RSS/Atom feed and returns a preview without subscribing.

#### Scenario: URL is a valid feed
- **WHEN** the MCP client calls `tools/call` with name `discover_feed` and arguments `{"url": "https://example.com/feed.xml"}`
- **AND** the URL returns valid RSS or Atom XML
- **THEN** the server SHALL respond with the feed's title, URL, and up to 3 sample item titles

#### Scenario: URL is a web page with alternate feed links
- **WHEN** the MCP client calls `discover_feed` with a URL that returns HTML containing `<link rel="alternate" type="application/rss+xml">` or `<link rel="alternate" type="application/atom+xml">`
- **THEN** the server SHALL attempt to parse each discovered feed URL and respond with the first valid feed's preview

#### Scenario: URL is not a feed
- **WHEN** the MCP client calls `discover_feed` with a URL that is neither a feed nor a page with feed links
- **THEN** the server SHALL respond with a text content stating the feed could not be found

### Requirement: add_feed tool

The server SHALL provide an `add_feed` tool that subscribes to a feed. The tool SHALL first discover the feed URL, then relay the subscription to the browser via the SSE bridge.

#### Scenario: add_feed succeeds
- **WHEN** the MCP client calls `tools/call` with name `add_feed` and arguments `{"url": "https://example.com"}`
- **AND** the feed is discovered successfully
- **AND** the browser is connected via EventSource
- **THEN** the server SHALL send an `add-feed` SSE event to the browser with the discovered feed details
- **AND** the server SHALL wait for the browser to acknowledge the write
- **AND** the server SHALL respond to the MCP client with the feed object

#### Scenario: add_feed with browser disconnected
- **WHEN** the MCP client calls `add_feed`
- **AND** the feed is discovered successfully
- **AND** no browser is connected via EventSource
- **THEN** the server SHALL respond with an error indicating the browser is not connected

### Requirement: remove_feed tool

The server SHALL provide a `remove_feed` tool that unsubscribes from a feed. The tool SHALL relay the unsubscription to the browser via the SSE bridge.

#### Scenario: remove_feed succeeds
- **WHEN** the MCP client calls `tools/call` with name `remove_feed` and arguments `{"url": "https://example.com/feed.xml"}`
- **AND** the browser is connected via EventSource
- **THEN** the server SHALL send a `remove-feed` SSE event to the browser with the feed URL
- **AND** the server SHALL wait for the browser to acknowledge
- **AND** the server SHALL respond to the MCP client confirming removal

#### Scenario: remove_feed with browser disconnected
- **WHEN** the MCP client calls `remove_feed`
- **AND** no browser is connected via EventSource
- **THEN** the server SHALL respond with an error indicating the browser is not connected

### Requirement: get_feed_items tool

The server SHALL provide a `get_feed_items` tool that fetches the latest items from a feed by making a direct HTTP request to the feed URL and parsing the response.

#### Scenario: get_feed_items returns items
- **WHEN** the MCP client calls `tools/call` with name `get_feed_items` and arguments `{"url": "https://example.com/feed.xml", "limit": 10}`
- **AND** the feed URL returns valid RSS or Atom XML
- **THEN** the server SHALL respond with an array of items (title, link, author, publishedAt, excerpt) up to the requested limit (default 20)

#### Scenario: get_feed_items for invalid URL
- **WHEN** the MCP client calls `get_feed_items` with a URL that returns an error or non-feed content
- **THEN** the server SHALL respond with a text content stating the feed could not be fetched

### Requirement: Browser SSE relay

The server SHALL expose an SSE endpoint at `GET /api/events` for the browser to receive push notifications. The server SHALL expose `POST /api/events` for the browser to send sync data and acknowledgments.

#### Scenario: Browser establishes SSE connection
- **WHEN** the browser opens an `EventSource` to `GET /api/events`
- **THEN** the server SHALL send a `keepalive` SSE event every 30 seconds

#### Scenario: Browser sends initial sync
- **WHEN** the browser connects to `/api/events`
- **THEN** the browser SHALL POST to `/api/events` with body `{"kind":"sync","feeds":[...]}`
- **AND** the server SHALL store the feed list in its in-memory cache

#### Scenario: Browser receives add-feed from server
- **WHEN** the MCP agent calls `add_feed`
- **THEN** the server SHALL send an SSE event `event: add-feed` with `data: {"id":"...","feed":{"url":"...","title":"..."}}`
- **AND** the browser SHALL call `upsertFeed()` in IndexedDB and POST `{"kind":"ack","id":"..."}` to `/api/events`

#### Scenario: Browser receives remove-feed from server
- **WHEN** the MCP agent calls `remove_feed`
- **THEN** the server SHALL send an SSE event `event: remove-feed` with `data: {"id":"...","url":"..."}`
- **AND** the browser SHALL call `unsubscribeFeed()` in IndexedDB and POST `{"kind":"ack","id":"..."}` to `/api/events`

#### Scenario: Browser notifies server of local change
- **WHEN** the user adds or removes a feed through the normal Sift UI
- **AND** the browser has an active EventSource connection
- **THEN** the browser SHALL POST to `/api/events` with the updated feed list
- **AND** the server SHALL update its in-memory cache

### Requirement: Feature gate

The server SHALL only mount MCP and relay routes when the `MCP_ENABLED` environment variable is set to `true`. The server SHALL expose a `GET /api/capabilities` endpoint that returns `{"mcp": true}` when MCP is enabled.

#### Scenario: MCP disabled server-side
- **WHEN** `MCP_ENABLED` is not set or is not `true`
- **THEN** the server SHALL NOT mount `/mcp`, `/api/events`, or `/api/capabilities`
- **AND** the browser SHALL receive a 404 for these endpoints
- **AND** the Settings UI SHALL NOT show the MCP section

#### Scenario: MCP enabled server-side
- **WHEN** `MCP_ENABLED` is set to `true`
- **THEN** the server SHALL mount `/mcp`, `/api/events`, and `/api/capabilities`
- **AND** `GET /api/capabilities` SHALL return `{"mcp":true}`
- **AND** the Settings UI SHALL show the MCP section

### Requirement: Settings UI

The Sift Settings drawer SHALL show an "MCP Server" section when the server reports MCP is available. The section SHALL include a toggle to enable/disable the browser's EventSource connection, the server endpoint URL, and a button to copy the MCP client configuration.

#### Scenario: User enables MCP in Settings
- **WHEN** the user toggles the MCP checkbox on
- **THEN** the browser SHALL open an EventSource to `GET /api/events`
- **AND** the browser SHALL send its initial feed list via `POST /api/events`
- **AND** the setting SHALL be persisted in IndexedDB

#### Scenario: User disables MCP in Settings
- **WHEN** the user toggles the MCP checkbox off
- **THEN** the browser SHALL close the EventSource connection

#### Scenario: Copy MCP config
- **WHEN** the user clicks the "Copy MCP Config" button
- **THEN** the browser SHALL copy a JSON configuration block to the clipboard with the server URL

### Requirement: Server fetch utility

The server SHALL export a shared fetch function for making upstream HTTP requests with proper timeout, User-Agent, and error handling. This SHALL be used by both the proxy routes (`/feed`, `/article`, `/img`) and the MCP `discover_feed` and `get_feed_items` tools.

#### Scenario: Fetch with timeout
- **WHEN** an upstream request exceeds 15 seconds
- **THEN** the fetch SHALL be aborted and reject with a timeout error
