# Sift

A simple, browser-first RSS reader. All logic runs in the browser tab;
the server is a stateless pipe that proxies network requests (CORS-safe)
and serves the static app shell.

- **Local-only**: subscriptions, items, read/starred state live in IndexedDB.
- **Portable**: import/export your subscription list as OPML.
- **Offline**: installable PWA; works offline against cached data.
- **Three deploy targets**: local dev, container, Cloudflare Workers — all from one codebase.
- **Full-text**: summary-only feeds get full-text extraction via Readability.

## Develop

```sh
npm install
npm run dev          # http://localhost:8787
```

## Build & run

```sh
npm run build       # outputs to dist/
npm start           # node + tsx serving dist/ and the proxy
# or:
bun server/bun.ts   # bun runtime
```

## Deploy

### Cloudflare Workers

```sh
npx wrangler deploy
```

### Docker

```sh
docker build -t sift .
docker run -p 8787:8787 sift
```

## Scripts

- `npm run dev` — Vite dev server with HMR and the Hono proxy mounted as middleware
- `npm run build` — produce `dist/`
- `npm start` — run the production node server (serves `dist/` and `/feed`, `/article`, `/img`)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — eslint
- `npm test` — vitest
- `npm run deploy` — `wrangler deploy`

## Privacy

The `/feed`, `/article`, and `/img` proxy endpoints forward your request to
the upstream URL and return the body. The proxy DOES NOT log upstream URLs
anywhere persistent. Each request is handled independently; no server-side
state is retained.

## Known v0 limitations

- **No multi-device sync.** Use OPML export/import for portability between devices.
- **No push notifications.** Refresh runs only while the app is open.
- **No bulk "mark all read" or multi-select.** Reading is the marking mechanism.
- **No per-feed customization** (colors, sort overrides, custom refresh intervals).
- **Service Worker background sync is not used** — feeds don't refresh when the tab is closed.
- **Search** searches only items currently in IndexedDB (not historical items that
  may have been evicted).
- **OPML import/export covers only the subscription list.** Read/starred state is
  intentionally not exported in v0 (no standard format).

## License

MIT
