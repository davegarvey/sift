# Sift

A simple, browser-first RSS reader. Feed parsing, item storage, and reading
state run in the browser tab; the server proxies network requests (CORS-safe),
uses short-lived feed caching and shared failure cooldown metadata to reduce
duplicate upstream requests, serves the static app shell, and optionally
provides multi-device sync and AI agent integration.

- **Local-only**: subscriptions, items, read/starred state, and lifetime reading statistics live in IndexedDB.
- **Multi-device sync**: optional D1-backed sync via Cloudflare Workers (pairing-code based), including exact group read-once deduplication and approximate observed volume. You can delete your server-side sync data from Settings.
- **Server-side polling**: on Workers, synced subscriptions are polled every 30 minutes, so items published while no device is open still arrive.
- **AI agent integration**: built-in MCP server for AI tool access to feeds.
- **Portable**: import/export your subscription list as OPML.
- **Offline**: installable PWA; works offline against cached data.
- **Deploy anywhere**: local dev, Node/Bun server, Docker, or Cloudflare Workers — all from one codebase.
- **Unread filter**: switch between Unread and All within the selected feed or tags. The choice is remembered on each device; Starred shows both read and unread saved articles.
- **Full-text**: summary-only feeds get full-text extraction via Readability.

Learn more about [Sift](https://sift.davegarvey.workers.dev/about), including its [privacy policy](https://sift.davegarvey.workers.dev/privacy) and [terms](https://sift.davegarvey.workers.dev/terms).

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

Node and Bun can store sync data in local SQLite files when `SIFT_DATA_DIR` is
set. Node requires 22.13 or later for `node:sqlite`. The sync and polling
databases are separate files; both runtimes apply the shared SQL migrations at
startup. Set `FEED_POLLING=true` to enable polling and daily maintenance.
Self-hosted SQLite supports one running Sift server process per data directory;
it is not a shared database for horizontal scaling.

## Deploy

### Cloudflare Workers

```sh
npm run deploy    # pull + build + apply sift-sync and sift-poll migrations + deploy
```

Migrations are applied as part of the deploy, immediately before the
Worker ships. Workers Builds uses `npm run deploy:ci` (same sequence,
no `git pull`) as its deploy command.

Polling uses a separate D1 database named `sift-poll`, bound as `POLL_DB`, so
its item store cannot fill the sync database. Create and bind it once before
deploying:

```sh
npx wrangler d1 create sift-poll
```

Copy the returned database ID into the `POLL_DB` entry in `wrangler.toml`.
Polling runs only when `FEED_POLLING = "true"` and the binding is present.
The Worker checks for due feeds every 10 minutes; each feed is normally
scheduled every 30 minutes. The default batch is 50 feeds per run, enough for
about 150 distinct feeds at that interval. A full batch measured about 255 D1
queries and 555 subrequests, within Workers Paid limits but above the Free
plan's 50 subrequests per invocation. Remove `FEED_POLLING` to disable polling;
browsers continue fetching feeds either way.

Two Workers rate limiting bindings, `PROXY_FETCH_LIMITER` and
`PROXY_IMAGE_LIMITER`, enforce the per-client proxy limits described under
[Proxy limits](#proxy-limits). They are declared in `wrangler.toml` and need
Wrangler 4.36 or later. Their `namespace_id` values (`7301` and `7302`) must be
unique within your Cloudflare account; change them if your account already uses
those IDs. Without the bindings the Worker falls back to a per-isolate limiter,
which is less accurate but keeps the proxy working.

Set a billing alert in the Cloudflare dashboard (Billing, Notifications) for
Workers usage. A per-address limit bounds one source but not many, and an
alert is the quickest way to notice a public instance being used as a general
fetcher.

### Docker

```sh
docker build -t sift .
docker run -p 8787:8787 sift
```

For a persistent instance, mount `/data`. The GHCR image uses Bun and enables
sync by default; polling remains opt-in:

```sh
docker run -d --name sift -p 8787:8787 -v sift-data:/data \
  -e FEED_POLLING=true ghcr.io/davegarvey/sift:latest
```

Compose:

```yaml
services:
  sift:
    image: ghcr.io/davegarvey/sift:latest
    ports:
      - "8787:8787"
    volumes:
      - sift-data:/data
    environment:
      FEED_POLLING: "true"
volumes:
  sift-data:
```

## Configuration

Copy `.env.example` to `.env` and set:

- `MCP_ENABLED=true` — enable the MCP server and SSE relay at `/mcp` and `/api/events`
- `TRUST_PROXY_HOPS` — number of reverse proxies in front of Node or Bun whose `X-Forwarded-For` entry may identify the client for proxy limits (default 0, which ignores the header and uses the socket address)

For Node and Bun:

- `SIFT_DATA_DIR` — enable sync and store the `sift-sync.sqlite` and `sift-poll.sqlite` files in this directory
- `FEED_POLLING=true` — enable server-side polling when `SIFT_DATA_DIR` is set; the process checks every 10 minutes
- `FEED_POLL_BATCH` and `POLL_DB_MAX_BYTES` — polling batch size and poll-database limit, with the same defaults as Workers

Cloudflare Workers variables (`wrangler.toml` `[vars]`):

- `FEED_POLLING=true` — poll synced subscriptions on the 10-minute cron and serve `/sync/items`
- `FEED_POLL_BATCH` — maximum feeds fetched per polling run (default 50, maximum 500)
- `POLL_DB_MAX_BYTES` — pause polling above this poll-database size in bytes (default 8 GiB)

Polling covers at most 500 feeds per account. Accounts with more feeds still
fetch the rest in their browsers. Daily maintenance rebuilds the URL registry
from accounts active in the last 14 days and deletes items older than 7 days.

### Proxy limits

`/feed`, `/article` and `/img` accept only requests from Sift's own origin:
a request with a `Sec-Fetch-Site` header other than `same-origin` or `none`
receives `403`, so other websites cannot embed or call the proxy. Requests
without the header, such as `curl`, are not rejected on that basis.

Each client address is also limited to 2000 `/feed` and `/article` requests
and, separately, 600 `/img` requests in each 60-second window; the excess
receives `429` with `Retry-After`. The budgets allow a 1000-feed OPML import
plus a 500-feed refresh, or three articles of 200 images each, in one minute
from one household behind one address. Cache hits count. A limited request is rejected
before any target lookup, so it uses none of the per-origin budget.

On Workers the limit uses the Workers rate limiting binding, keyed by
`CF-Connecting-IP`, with no D1 writes. Cloudflare counts per location and
eventually consistently, so enforcement is approximate. Node and Bun, and
Workers without the binding, use a process-local limiter keyed by the socket
address; behind a reverse proxy or Docker network address translation, all
clients then share one budget unless `TRUST_PROXY_HOPS` is set. IPv6 clients
are keyed by /64 prefix.

`/feed` responses are capped at 2 MiB, `/article` at 5 MiB and `/img` at
10 MiB. A larger declared `Content-Length` returns `502`; a larger streamed
body is aborted at the cap, which the browser sees as a failed request.
Sync rate limits use Cloudflare's `CF-Connecting-IP`; `X-Forwarded-For` is
ignored because clients can supply it themselves.

## Scripts

- `npm run dev` — Vite dev server with HMR and the Hono proxy mounted as middleware
- `npm run build` — produce `dist/`
- `npm start` — run the production node server (serves `dist/`, proxy, API, MCP, and sync routes)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — eslint
- `npm test` — vitest unit/integration tests
- `npm run test:smoke` — Playwright smoke tests (requires `npm run dev`)
- `npm run spec:validate` — strict OpenSpec validation of `openspec/specs/` (runs in CI)
- `npm run deploy` — `git pull --ff-only && vite build && wrangler d1 migrations apply sift-sync --remote && wrangler d1 migrations apply sift-poll --remote && wrangler deploy`
- `npm run deploy:ci` — same, without `git pull` (Workers Builds deploy command)

## Privacy

The `/feed`, `/article`, and `/img` proxy endpoints forward your request to
the upstream URL and return the body. Only absolute HTTP(S) URLs whose literal
or resolved target passes the public-target safety checks are requested. Normal
public redirects are followed for up to five hops with each destination checked
again; unsafe, malformed, or excessive redirects return a generic upstream
failure and are not passed to the browser. Successful `/feed` responses are
held in a bounded cache keyed by the complete upstream URL, including responses
that set cookies (the proxy never forwards them). Each copy is fresh for the
longer of 15 minutes and the upstream's own hints (`Cache-Control`, `Expires`,
RSS `<ttl>`, `sy:updatePeriod`), capped at 24 hours, and is kept for a further
24 hours. While an upstream is rate limiting, challenging, timing out or
returning server errors, the proxy serves that retained copy with
`X-Sift-Cache: stale` and `X-Sift-Retry-After` instead of the failure, and the
browser does not flag the feed unless it has not been received for 24 hours.
Node/Bun use process-local memory; Cloudflare Workers also use the
Workers Cache API when available, with data-center-local, best-effort reuse.
Requests to the same origin are spaced at least one second apart and limited
to four in flight per runtime. Workers reserve those slots and share `429` and
`419` cooldowns through D1 using only a SHA-256 origin key; Node/Bun and local
development use process-local state. If D1 is unavailable, the Worker falls
back to its runtime-local gate. Queue waits are bounded and an overloaded
origin receives a local `429` with `Retry-After` instead of another upstream
request. Redirect destinations use the same policy. A valid upstream
`Retry-After` is honored without shortening it; absent `429` headers use a
30-minute fallback, while headerless `419` responses back off for 6, 12, then
24 hours. Other upstream errors use a 30-minute fallback capped at 24 hours.
All proxy errors are `no-store`; `/img` uses immutable caching only for
successful images. Every proxy response, including errors, carries a
sandboxing `Content-Security-Policy` and `X-Content-Type-Options: nosniff`, so
proxied content opened directly runs in an opaque origin without scripts and
cannot read Sift's storage. Error responses are plain text and never forward
upstream headers, and `/img` refuses upstream responses that are not
`image/*`. Response headers identify whether a response came from the
upstream, a feed cache, a URL cooldown, an origin cooldown, or the local gate.

The feed body cache is not part of sync or persistent storage. Cloudflare
Workers store hashed feed failure keys and hashed origin reservation/cooldown
metadata in the sync D1 database; neither is exposed through the sync API.
Successful proxy bodies and validators use the existing cache layers, with
failure markers stored under separate keys. Diagnostics contain only a hashed
origin, route, status, retry timing, and a short allowlist of response
metadata. Same-site and per-client rejections are logged with only the route,
status and reason, never a client address or URL. The ordinary proxy does not persist upstream URLs, query strings,
response bodies, or article IDs. Worker cache hits still count as Worker
requests against the account plan limits. Target checks are application-level
filtering and do not pin a hostname to one DNS answer for the lifetime of a
connection.

When `FEED_POLLING=true`, the Worker polls each distinct feed URL subscribed
by a synced group that has pulled within the last 14 days, through the same
cache, cooldowns and request governor as `/feed`. It stores, per feed URL and
without any sync key, each new entry's title, link, author, date, excerpt,
thumbnail URL and feed HTML when that is at most 64 KiB, together with the
URL's validators and next poll time. Entries are deleted 7 days after they
were first seen, and polling state is deleted once no group subscribes to
the URL. `/sync/pull` records when a group was last active, at most once an
hour, whether or not polling is enabled; polling and account retention both
use it. Devices fetch these entries with `/sync/items` and keep only entries
they do not already hold. The full feed URL is stored in `POLL_DB`, including
any access token embedded in a private-feed URL. `/sync/items` returns entries
only to accounts that currently subscribe to that exact URL. Enable polling
only if you are comfortable storing those URLs and feed entries on the server.
If `FEED_POLLING` is not `true` or `POLL_DB` is not bound, the server stores
no polled feed entries.

Sync data is kept until you delete it or the account expires. Settings → Sync
→ Delete sync data calls `DELETE /sync/account` (master key only), which in
one transaction deletes the account and every row keyed by its sync key:
subscriptions (including removed ones still awaiting cleanup), read and starred
flags, reading statistics, agent tokens, pairing codes and the rate-limit
counters for that key. Agent tokens and pairing codes stop working at once.
Data on your devices is not touched, other paired devices stop syncing, and
when polling is enabled any polled feed URLs and entries that no other group
subscribes to are deleted immediately (otherwise by the next daily pass).
Disabling sync does not delete anything: the key leaves the device but the
data stays on the server, so delete it first. The daily cron also deletes, with
all their rows, accounts with no sync pull for 365 days (or, if they never
pulled, created more than 365 days ago) and accounts whose key was regenerated
more than 30 days ago. At most 50 accounts are deleted per run. Deleted sync
data can persist in Cloudflare D1's point-in-time recovery (Time Travel) for up
to 30 days on the Workers Paid plan, after which it is gone. The
`/api/events` SSE relay and `/mcp` endpoint are in-memory only and do
not persist data. Sync state is stored in Cloudflare D1 and is never logged
or exposed to third parties. Synced lifetime reading statistics contain only
per-feed aggregate counters and compact per-item `everRead` markers; article
content and a detailed reading event history are not synchronized. Authorized
agent pulls can read the same aggregate statistics, while only the master sync
key can write statistics snapshots or historical markers. Agent tokens are
stored in D1 as SHA-256 hashes only — the raw token never touches the
database — and are revocable from Settings.

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
siftctl stats --json
siftctl --version
```

Environment: `SIFTCTL_TOKEN` (overrides the token file at
`~/.config/siftctl/token`), `SIFTCTL_URL` (defaults to the hosted deployment),
`SIFTCTL_HOME`. Exit codes: 0 success, 1 runtime/API error, 2 usage. `feed add`
discovers the feed title and HTML URL when available, while `feed edit` updates
the title or comma-separated tags. Tags are trimmed, lowercased, whitespace-
normalized, deduplicated, and limited to 64 characters. All data commands and
mutations support `--json` for machine consumption. Mutation results use stable
objects such as `{ "ok": true, "operation": "edit", "feedId": "...", "url": "...", "title": "...", "tags": ["..."] }`.

`siftctl stats` requires a paired agent token and reads the server-committed
statistics snapshot; it cannot read device-local IndexedDB statistics. The
browser may have newer pending sync data, and observed article volume is an
approximate aggregate across devices. The command does not expose article
content, reading-event history, reading duration, or trends. `--version` and
`-v` print the installed CLI version without pairing or network access.

With `--json`, stats output has a stable shape for scripts and LLMs:

```json
{
  "source": "sync",
  "approximate": true,
  "summary": {
    "totalSeen": 1200,
    "readOnce": 340,
    "readRate": 0.2833333333333333
  },
  "feeds": [
    {
      "feedId": "feed-id",
      "title": "Example Feed",
      "url": "https://example.com/feed.xml",
      "totalSeen": 100,
      "readOnce": 60,
      "readRate": 0.6,
      "expectedReads": 28.333333333333332,
      "readIndex": 2.1176470588235294,
      "backlog": 40
    }
  ]
}
```

`readRate`, `expectedReads`, and `readIndex` are `null` when there is not
enough data to calculate them.

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
  master sync key, which never leaves your browser. Tokens can call
  `/sync/pull`, `/sync/stats/pull`, and `/sync/push`; statistics writes remain
  master-key-only. They cannot mint device codes, register, or manage tokens
  (a device code would redeem to the master key).
- **Revocation**: Settings → Sync → Agents lists every token (by fingerprint)
  with a revoke button. Revocation is immediate and does not affect your
  devices. Regenerating the sync key (Settings → Sync → Regenerate) is the
  kill switch: the old key is marked dead server-side — every agent token
  stops working instantly, `register` refuses to resurrect the old key, and
  other devices must re-pair with the new key. Rotation does not delete the
  old key's data at once; it is deleted 30 days later (see Privacy).
  Settings → Sync → Delete sync data deletes the account and every token
  immediately.
- **Warning**: a token grants read/write of your subscriptions to whoever
  holds it. Treat it like a password; if you paste it into a third-party
  service, you are trusting that service with it. Revoke it when done. A
  pairing code pasted into a chat tool is far less dangerous — read-only and
  dead in 5 minutes — but agents share your per-sync-key pull budget with
  your browsers, so a runaway agent can slow your devices' sync.

## Known v0 limitations

- **Self-hosted sync is single-process.** Node, Bun and Docker can use local SQLite, but multiple Sift processes cannot share the same data directory.
- **No push notifications.** Browser refresh runs only while the app is open; on Workers with polling enabled, synced devices receive items polled in the meantime on their next sync.
- **No bulk "mark all read" or multi-select.** Reading is the marking mechanism.
- **No per-feed customization** (colors, sort overrides, custom refresh intervals).
- **Service Worker background sync is not used** — without server-side polling, feeds don't refresh when the tab is closed.
- **Search** matches article titles and summaries, not article text, and covers
  only the articles stored on the device.
- **Local article retention.** Unstarred article bodies are removed after 90 days
  without appearing in a feed refresh or sync pull. Unstarred unread records are
  removed after 365 days; read and starred records remain. Settings shows local
  storage usage and lets you request persistent browser storage.
- **OPML import/export covers only the subscription list.** Read/starred state is
  intentionally not exported in v0 (no standard format).
- **MCP is experimental.** The MCP server tools and SSE relay may change in breaking ways.

## License

MIT
