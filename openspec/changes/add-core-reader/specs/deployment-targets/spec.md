## ADDED Requirements

### Requirement: Server SHALL run identically in three deploy contexts
The server code SHALL be deployable to three contexts without source modification: local development, a container image, and Cloudflare Workers. The behavior of all three deploy targets SHALL be identical for every request.

#### Scenario: Server runs in local development
- **WHEN** a developer runs the local dev command (e.g., `npm run dev`)
- **THEN** the static app shell is served alongside the `/feed`, `/article`, and `/img` proxy endpoints with hot module reloading for the app

#### Scenario: Server runs in a container
- **WHEN** a container built from the project's `Dockerfile` is started
- **THEN** the static app shell, `/feed`, `/article`, and `/img` endpoints are served from the container's HTTP listener

#### Scenario: Server runs on Cloudflare Workers
- **WHEN** the project is deployed via `wrangler deploy`
- **THEN** the Worker's `fetch` handler serves the static app shell and the `/feed`, `/article`, and `/img` endpoints

#### Scenario: Behavior is identical across targets
- **WHEN** an identical request is sent to all three deploy targets
- **THEN** each target returns an identical response for that request

### Requirement: Server SHALL be stateless across requests
The server SHALL retain no state between requests. No database, no key-value store, no in-memory session state, no long-lived connections SHALL exist server-side. Each request SHALL be handled independently.

#### Scenario: Two consecutive requests are independent
- **WHEN** a client makes request A followed by request B to the same server
- **THEN** the server processes request B with no knowledge of request A beyond what is in request B's headers and body

#### Scenario: Server restarts between requests
- **WHEN** the server process or Worker isolate is recreated between two requests by the runtime
- **THEN** the server continues to function normally because no state was retained in memory

### Requirement: Server SHALL support conditional HTTP requests transparently
The `/feed` and `/article` endpoints SHALL forward client-supplied `If-None-Match` and `If-Modified-Since` headers to the upstream and SHALL return the upstream's `ETag`, `Last-Modified`, and `304 Not Modified` responses unchanged to the client. The `/img` endpoint is a single-shot fetch (no conditional headers) and returns the upstream image body with its `Content-Type`.

#### Scenario: Client sends conditional headers to the feed proxy
- **WHEN** a request to `/feed?url=<encoded>` includes `If-None-Match` and `If-Modified-Since`
- **THEN** the server forwards those headers to the upstream feed

#### Scenario: Upstream responds 304 to a conditional request
- **WHEN** the upstream returns `304 Not Modified`
- **THEN** the server returns `304 Not Modified` to the client without a body, preserving the upstream's response headers where applicable

### Requirement: Server SHALL NOT log upstream URLs persistently
Neither the `/feed`, `/article`, nor `/img` endpoint SHALL write upstream URLs to any persistent log, analytics sink, or database. Local development MAY log request metadata (status, timing) for debugging, but SHALL NOT log the URL parameter by default.

#### Scenario: Production server handles a request
- **WHEN** a request to `/feed?url=<secret-feed-url>` is handled in production (container or Cloudflare Workers)
- **THEN** no log entry contains the upstream URL

#### Scenario: Local development handles a request
- **WHEN** a request to `/feed?url=<url>` is handled in local dev
- **THEN** the default log output does not contain the URL
- **AND** if a debug-logging flag is enabled explicitly by the developer, the URL MAY be included in the local console output only

### Requirement: Outbound requests SHALL identify the reader with a User-Agent
The server SHALL send a `User-Agent` header identifying the application on outbound fetches to upstream feeds and articles. The User-Agent SHALL be a single descriptive string (e.g., `rss-reader/0.0 (+https://github.com/<user>/rss-reader)`) and SHALL NOT impersonate other clients.

#### Scenario: Server fetches an upstream feed
- **WHEN** the server makes an outbound request to an upstream feed
- **THEN** the request includes a `User-Agent` header identifying the reader application

### Requirement: Server SHALL run on free-tier Cloudflare Workers within documented usage limits
The server SHALL be operable within the Cloudflare Workers free-tier daily request cap (100,000 requests/day) for a single-user workload of roughly 50 subscribed feeds refreshing approximately hourly, plus occasional article extractions.

#### Scenario: Single user refreshes 50 feeds hourly
- **WHEN** a single user with 50 subscribed feeds refreshes hourly with conditional requests
- **THEN** the daily request count is well below the Workers free-tier cap (estimate ~1,200 refresh requests + article extractions per day)
- **AND** the application remains operational without paid Workers tier upgrade

### Requirement: Project SHALL be licensed under MIT
The project's `LICENSE` file SHALL contain the MIT License text. All source files SHALL be copyright-and-license-compatible with MIT (no incompatible third-party code vendored).

#### Scenario: Repository is inspected for licensing
- **WHEN** the repository root is inspected
- **THEN** a `LICENSE` file containing the standard MIT License text is present
- **AND** the `package.json` declares `"license": "MIT"`

### Requirement: The app SHALL be installable as a PWA
The app SHALL include a web manifest and a service worker (generated via `vite-plugin-pwa` or equivalent) that precaches the app shell so the app can be installed to a home screen or desktop and booted offline.

#### Scenario: User installs the app
- **WHEN** the user uses the browser's "Install app" affordance
- **THEN** the app is installed with name "rss", a standalone display mode, and an icon

#### Scenario: User loads the app with no network
- **WHEN** the user opens the installed app with no network connection and a previously-cached service worker state
- **THEN** the app shell loads from cache and IndexedDB drives the UI without blocking
- **AND** feed refresh and article extraction attempt fail gracefully with no fatal errors