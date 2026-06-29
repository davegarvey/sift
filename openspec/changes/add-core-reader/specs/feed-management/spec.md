## ADDED Requirements

### Requirement: Server shall expose a stateless feed proxy endpoint
The server SHALL expose `GET /feed?url=<encoded>` that fetches the upstream feed and returns the upstream body with `Content-Type: application/xml; charset=utf-8`. The endpoint SHALL forward `If-None-Match` and `If-Modified-Since` request headers from the client and shall return upstream `ETag`/`Last-Modified` and `304 Not Modified` responses unchanged. The endpoint SHALL NOT log the upstream URL anywhere persistent.

#### Scenario: Client requests a fresh feed
- **WHEN** the client requests `/feed?url=<encoded>` with no conditional headers
- **THEN** the server fetches the upstream feed and returns the body with `Content-Type: application/xml; charset=utf-8` and whatever `ETag`/`Last-Modified` the upstream sent

#### Scenario: Client requests a feed with conditional headers
- **WHEN** the client provides `If-None-Match` and/or `If-Modified-Since` and the upstream responds `304`
- **THEN** the server returns `304 Not Modified` to the client without a body

#### Scenario: Upstream returns an error
- **WHEN** the upstream responds `404`, `403`, `5xx`, or times out
- **THEN** the server returns the upstream status (or `502` on timeout/transport failure) to the client without parsing or transforming the body

### Requirement: Server shall expose a stateless article proxy endpoint
The server SHALL expose `GET /article?url=<encoded>` that fetches the upstream article HTML and returns the upstream body with `Content-Type: text/html; charset=utf-8`. The endpoint SHALL NOT parse, transform, or extract content. The endpoint SHALL NOT log the upstream URL anywhere persistent.

#### Scenario: Client requests an article for extraction
- **WHEN** the client requests `/article?url=<encoded>`
- **THEN** the server fetches the upstream HTML and returns the body unchanged with `Content-Type: text/html; charset=utf-8`

#### Scenario: Upstream returns an error
- **WHEN** the upstream responds `404`, `403`, `5xx`, or times out
- **THEN** the server returns the upstream status (or `502` on timeout/transport failure) to the client without transforming the body

### Requirement: Server shall serve the static app shell and assets
The server SHALL serve `index.html` at `/` and bundled assets under `/assets/*` from the built static output. No server-side templating, hydration, or rendering SHALL occur.

#### Scenario: Client requests the root path
- **WHEN** the client requests `GET /`
- **THEN** the server returns the built `index.html` from the static output directory

#### Scenario: Client requests a bundled asset
- **WHEN** the client requests `GET /assets/<filename>`
- **THEN** the server returns the matching asset from the static output directory with appropriate long-lived cache headers

### Requirement: Server shall be the only network exit for feeds and articles
The browser SHALL NOT make direct cross-origin requests to feed or article URLs. All feed and article fetching SHALL go through the `/feed` and `/article` proxy endpoints.

#### Scenario: Browser fetches a feed
- **WHEN** the app needs to refresh a feed
- **THEN** the app calls `GET /feed?url=<encoded>` and parses the response body in the browser

#### Scenario: Browser fetches an article for extraction
- **WHEN** the app needs to extract full-text from an article
- **THEN** the app calls `GET /article?url=<encoded>` and runs Readability on the response body in the browser

### Requirement: Feed parsing shall support RSS 2.0, Atom 1.0, and RDF (RSS 1.0)
The app SHALL parse RSS 2.0, Atom 1.0, and RDF (RSS 1.0) feeds in the browser using a feed-parsing library (e.g., `@extractus/feed-extractor`). Items SHALL be deduplicated by `guid` when present, otherwise by a synthetic GUID composed of `link + publishedAt`.

#### Scenario: App parses an RSS 2.0 feed
- **WHEN** the parser receives a valid RSS 2.0 feed
- **THEN** the app extracts feed metadata (title, home URL, description) and a list of items with title, link, published date, excerpt or content, and guid

#### Scenario: App parses an Atom 1.0 feed
- **WHEN** the parser receives a valid Atom 1.0 feed
- **THEN** the app extracts feed metadata and a list of items, mapping `<id>` to guid, `<link href>` to link, `<updated>` or `<published>` to publishedAt

#### Scenario: App parses an RDF (RSS 1.0) feed
- **WHEN** the parser receives a valid RDF feed
- **THEN** the app extracts feed metadata and a list of items consistent with the RSS 2.0 item shape

#### Scenario: A feed item has no guid
- **WHEN** a parsed item lacks a guid
- **THEN** the app synthesizes a guid from `link + publishedAt` and uses it for dedup

### Requirement: Feed subscription shall support auto-discovery from any URL
The app SHALL accept any URL in the Add Feed input and discover the underlying feed by: attempting to parse the body as a feed; if not a feed, fetching the page (via `/article` proxy) and searching for `<link rel="alternate" type="application/rss+xml" ...>` and `application/atom+xml` link tags; following discovered links to confirm they parse as feeds.

#### Scenario: Pasted URL is a direct feed URL
- **WHEN** the app fetches the pasted URL via `/feed` and the body parses as a valid feed
- **THEN** the app reports the discovered feed (title + recent item count) for user confirmation

#### Scenario: Pasted URL is a homepage with a feed link
- **WHEN** the pasted URL body does not parse as a feed but contains a `<link rel="alternate" type="application/rss+xml">` or `application/atom+xml` link
- **THEN** the app fetches the discovered feed URL via `/feed` and reports it for user confirmation

#### Scenario: Pasted URL yields no discoverable feed
- **WHEN** neither the pasted URL body nor any discovered alternate links parse as a valid feed
- **THEN** the app reports a discovery error with retry and cancel options

### Requirement: Refresh scheduler SHALL run in the browser and refresh stale feeds
The app SHALL maintain a refresh scheduler that runs while the tab is open. On app open and on a periodic tick (default 5 minutes), the scheduler SHALL refresh every feed whose `lastFetched + learnedIntervalMs < now`. The scheduler SHALL use conditional requests (`If-None-Match`, `If-Modified-Since`) for politeness and bandwidth efficiency.

#### Scenario: App opens with stale feeds
- **WHEN** the app boots and at least one feed has `lastFetched + learnedIntervalMs < now`
- **THEN** those feeds are refreshed concurrently, with conditional headers forwarded via `/feed`

#### Scenario: Tab stays open and a feed's interval elapses
- **WHEN** the periodic scheduler tick fires and a feed's `lastFetched + learnedIntervalMs < now`
- **THEN** that feed is refreshed

#### Scenario: Tab is closed
- **WHEN** the user closes the browser tab
- **THEN** no refreshes occur until the app is next opened
- **AND** the next open triggers refreshes for stale feeds

#### Scenario: Conditional request returns 304
- **WHEN** a refresh request to `/feed` returns `304 Not Modified`
- **THEN** the app updates `lastFetched` for that feed and does not re-parse the body or update items

### Requirement: Per-feed refresh interval SHALL be learned from observed cadence
Each feed's `learnedIntervalMs` SHALL start at 60 minutes (3,600,000ms) and adapt over time based on observed item arrivals. The floor is 30 minutes and the ceiling is 24 hours.

#### Scenario: A new feed is subscribed
- **WHEN** the user subscribes to a new feed
- **THEN** the feed's `learnedIntervalMs` is initialized to 3,600,000ms (60 minutes)

#### Scenario: A feed publishes frequently
- **WHEN** a feed has been observed to publish more than 10 items per day
- **THEN** the app decreases the feed's `learnedIntervalMs` toward the 30-minute floor

#### Scenario: A feed publishes rarely
- **WHEN** a feed has been observed to publish fewer than 2 items per day for at least 5 days
- **THEN** the app increases the feed's `learnedIntervalMs` toward the 24-hour ceiling

### Requirement: Items SHALL be stored with stable identity across refreshes
The app SHALL assign each item a stable identity derived from its feed URL and guid (or synthetic guid). Re-parsing a feed SHALL NOT create duplicate items; existing items SHALL be updated in place if their content has changed (e.g., updated content, corrected title).

#### Scenario: A feed is refreshed and contains the same items
- **WHEN** a refreshed feed contains items whose guids already exist in IndexedDB
- **THEN** no duplicate items are created; existing item records are preserved

#### Scenario: A feed item's content has changed since last refresh
- **WHEN** a refreshed feed contains an item whose guid matches an existing item but whose updated content differs
- **THEN** the existing item's content is updated and the item's `updatedAt` is set to the new upstream value

### Requirement: Fetching state SHALL be visible without clutter
The app SHALL reflect in-flight refreshes via a lightweight indicator (e.g., a spinner on the refresh affordance) and SHALL NOT block user interaction with already-stored items while refreshes are in progress.

#### Scenario: A refresh is in flight
- **WHEN** one or more feeds are currently being fetched
- **THEN** a lightweight indicator is shown on the refresh affordance
- **AND** the user can continue reading and navigating existing items without interruption

#### Scenario: A refresh for a specific feed fails
- **WHEN** a feed refresh returns an error status
- **THEN** an error state is recorded for that feed (visible in the sidebar beside the feed name) without interrupting other feeds' refreshes