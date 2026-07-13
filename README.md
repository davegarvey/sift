# Sift

A simple, browser-first RSS reader. All logic runs in the browser tab;
the server proxies network requests (CORS-safe), serves the static app shell,
and optionally provides multi-device sync and AI agent integration.

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
npm run deploy    # git pull + vite build + wrangler deploy
```

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
- `npm test` — vitest
- `npm run deploy` — `git pull && vite build && wrangler deploy`

## Privacy

The `/feed`, `/article`, and `/img` proxy endpoints forward your request to
the upstream URL and return the body. The proxy DOES NOT log upstream URLs
anywhere persistent.

The `/api/events` SSE relay and `/mcp` endpoint are in-memory only and do
not persist data. Sync state is stored in Cloudflare D1 and is never logged
or exposed to third parties.

## MCP server

When `MCP_ENABLED=true`, the server exposes a Model Context Protocol endpoint
at `/mcp` for AI agent integration. Available tools: `list_feeds`, `get_feed`,
`discover_feed`, `add_feed`, `remove_feed`, `get_feed_items`. An SSE relay at
`/api/events` provides real-time browser communication for feed operations.

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
