# Sift

A simple, browser-first RSS reader. Feed parsing, item storage, and reading
state run in the browser tab; the server proxies network requests (CORS-safe),
uses a short-lived feed response cache to reduce duplicate upstream requests,
serves the static app shell, and optionally provides multi-device sync and AI
agent integration.

- **Local-only**: subscriptions, items, read/starred state live in IndexedDB.
- **Multi-device sync**: optional D1-backed sync via Cloudflare Workers (pairing-code based).
- **AI agent integration**: built-in MCP server for AI tool access to feeds.
- **Portable**: import/export your subscription list as OPML.
- **Offline**: installable PWA; works offline against cached data.
- **Deploy anywhere**: local dev, Node/Bun server, Docker, or Cloudflare Workers — all from one codebase.
- **Full-text**: summary-only feeds get full-text extraction via Readability.

## Develop

```sh
npm install
npm run dev          # http://localhost:8787
```

## Build & run

```sh
npm run build       # outputs to dist/
npm start           # node + tsx serving dist/, proxy, and API routes
# or:
bun server/bun.ts   # bun runtime
```

## Deploy

### Cloudflare Workers

```sh
npm run deploy    # git pull + vite build + d1 migrations apply + wrangler deploy
```

Migrations are applied as part of the deploy, immediately before the
Worker ships. Workers Builds uses `npm run deploy:ci` (same sequence,
no `git pull`) as its deploy command.

### Docker

```sh
docker build -t sift .
docker run -p 8787:8787 sift
```

## Configuration

Copy `.env.example` to `.env` and set:

- `MCP_ENABLED=true` — enable the MCP server and SSE relay at `/mcp` and `/api/events`

## Scripts

- `npm run dev` — Vite dev server with HMR and the Hono proxy mounted as middleware
- `npm run build` — produce `dist/`
- `npm start` — run the production node server (serves `dist/`, proxy, API, MCP, and sync routes)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — eslint
- `npm test` — vitest unit/integration tests
- `npm run test:smoke` — Playwright smoke tests (requires `npm run dev`)
- `npm run deploy` — `git pull && vite build && wrangler d1 migrations apply sift-sync --remote && wrangler deploy`
- `npm run deploy:ci` — same, without `git pull` (Workers Builds deploy command)

## Privacy

The `/feed`, `/article`, and `/img` proxy endpoints forward your request to
the upstream URL and return the body. Successful `/feed` responses may be
held in a bounded cache for up to 15 minutes, keyed by the complete upstream
URL. Node/Bun use process-local memory; Cloudflare Workers also use the
Workers Cache API when available, with data-center-local, best-effort reuse.
The cache is not part of sync or persistent storage. Worker cache hits still
count as Worker requests against the account plan limits. The proxy DOES NOT
log upstream URLs anywhere persistent.

The `/api/events` SSE relay and `/mcp` endpoint are in-memory only and do
not persist data. Sync state is stored in Cloudflare D1 and is never logged
or exposed to third parties. Agent tokens are stored in D1 as SHA-256 hashes
only — the raw token never touches the database — and are revocable from
Settings.

## MCP server

When `MCP_ENABLED=true`, the server exposes a Model Context Protocol endpoint
at `/mcp` for AI agent integration. Available tools: `list_feeds`, `get_feed`,
`discover_feed`, `add_feed`, `remove_feed`, `get_feed_items`. The endpoint
serves both the `2025-11-25` and `2026-07-28` protocol revisions — modern
clients negotiate via `server/discover`; legacy clients fall back to the
`initialize` handshake. An SSE relay at `/api/events` provides real-time
browser communication for feed operations.

MCP is a **local-only** feature of the Node/Bun server. For agent access on
the hosted deployment, use the sync API instead (below).

## AI agents (sync API)

The sync API treats an AI agent as just another sync device. Agents read
feeds and change subscriptions through the same D1-backed, multi-tenant,
conflict-merged sync the browsers use — no MCP, no gateway process.

### Via `siftctl` (recommended)

Published to npm on each release. Install and pair:

```sh
npm i -g siftctl        # or: npx siftctl
siftctl pair <code>     # code from Settings → Sync → Agents
siftctl feeds
siftctl feed add https://example.com/feed.xml
siftctl feed edit https://example.com/feed.xml --title "Example" --tags "tech, reading"
siftctl feed remove https://example.com/feed.xml --yes
siftctl items https://example.com/feed.xml
siftctl mark read '<feed-id>::<guid>'
```

Environment: `SIFTCTL_TOKEN` (overrides the token file at
`~/.config/siftctl/token`), `SIFTCTL_URL` (defaults to the hosted deployment),
`SIFTCTL_HOME`. Exit codes: 0 success, 1 runtime/API error, 2 usage. `feed add`
discovers the feed title and HTML URL when available, while `feed edit` updates
the title or comma-separated tags. Tags are trimmed, lowercased, whitespace-
normalized, deduplicated, and limited to 64 characters. All data commands and
mutations support `--json` for machine consumption. Mutation results use stable
objects such as `{ "ok": true, "operation": "edit", "feedId": "...", "url": "...", "title": "...", "tags": ["..."] }`.

### Via the OpenAPI document

The sync API is described at `https://sift.davegarvey.workers.dev/openapi.json`.
Point an OpenAPI-aware agent (ChatGPT Actions, a coding agent like Claude
Code or opencode) at that URL with `X-Sync-Key` as the API-key header.
Writes carry no timestamps — the server stamps everything.

### Via a hosted chat tool (ChatGPT, Claude web)

Hosted chat tools cannot POST or send auth headers, but they can fetch plain
GET URLs. Settings → Sync → Agents → "Copy prompt" gives a prompt built for
them:

- **Reads**: the agent fetches `GET /sync/pull?code=<code>`. The code is the
  credential — read-only, multi-use, valid until its 5-minute expiry, and
  rate-limited per IP. No token is minted, so nothing to revoke.
- **Writes**: the agent proposes adds as clickable links
  `…/?intent=add&url=<feed-url>`. Clicking opens the app's add-feed modal
  prefilled; you approve by running discovery and subscribing. The agent
  never touches your subscriptions directly.

### Pairing and tokens

- Pairing: Settings → Sync → Agents → "Pair an agent" mints an 8-character
  code (5-minute expiry), embedded in the copied prompt and the `siftctl pair`
  command. `siftctl pair` or `POST /sync/tokens/redeem` exchange it for a
  token. The same code works on `GET /sync/pull` as a read-only credential
  for hosted chat agents.
- Tokens are 23-character credentials starting with `t` — distinct from the
  master sync key, which never leaves your browser. Tokens can only call
  `/sync/pull` and `/sync/push`; they cannot mint device codes, register, or
  manage tokens (a device code would redeem to the master key).
- **Revocation**: Settings → Sync → Agents lists every token (by fingerprint)
  with a revoke button. Revocation is immediate and does not affect your
  devices. Regenerating the sync key (Settings → Sync → Regenerate) is the
  kill switch: the old key is marked dead server-side — every agent token
  stops working instantly, `register` refuses to resurrect the old key, and
  other devices must re-pair with the new key.
- **Warning**: a token grants read/write of your subscriptions to whoever
  holds it. Treat it like a password; if you paste it into a third-party
  service, you are trusting that service with it. Revoke it when done. A
  pairing code pasted into a chat tool is far less dangerous — read-only and
  dead in 5 minutes — but agents share your per-sync-key pull budget with
  your browsers, so a runaway agent can slow your devices' sync.

## Known v0 limitations

- **Sync is Workers-only.** The `/sync/*` routes require Cloudflare D1; the Node/Bun adapters don't include them.
- **No push notifications.** Refresh runs only while the app is open.
- **No bulk "mark all read" or multi-select.** Reading is the marking mechanism.
- **No per-feed customization** (colors, sort overrides, custom refresh intervals).
- **Service Worker background sync is not used** — feeds don't refresh when the tab is closed.
- **Search** searches only items currently in IndexedDB (not historical items that
  may have been evicted).
- **OPML import/export covers only the subscription list.** Read/starred state is
  intentionally not exported in v0 (no standard format).
- **MCP is experimental.** The MCP server tools and SSE relay may change in breaking ways.

## License

MIT
