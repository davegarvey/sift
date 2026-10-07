## Context

`/feed`, `/article` and `/img` fetch any public URL for any caller. The existing controls protect upstream sites and private networks. Nothing limits a single client, checks that the caller is Sift's own front end, or bounds proxy response sizes. The hosted instance runs on Cloudflare Workers, where the exposures are request volume, CPU time and the domain's reputation. The browser client already calls the proxy from the same origin, so the changes are server-side only.

## Goals / Non-Goals

**Goals:**

- Stop other websites embedding or calling the proxy.
- Bound what one client address can request, without affecting a large import, an image-heavy article or a household behind one address.
- Bound the size of `/article` and `/img` bodies without buffering them.
- Add no D1 write per proxy request.

**Non-Goals:** authentication, CAPTCHAs, domain allowlists, changes to target and redirect policy, and the `/mcp` and `/sync` routes. A per-IP limit is not a defence against a distributed caller; it bounds a single source.

## Decisions

### Request pipeline

Each proxy path gets two middleware in this order: the existing isolation middleware, then a guard that runs the same-site check and the per-client limit. The guard runs before the route handler, so it precedes target validation (which can issue DNS-over-HTTPS requests), cache lookups and the origin governor. A rejected request therefore consumes no governor slot, reservation or D1 write. Isolation wraps the guard, so rejections carry the isolation headers without extra code.

### Same-site check

Reject when `Sec-Fetch-Site` is present and is neither `same-origin` nor `none`, with `403`. `none` covers address-bar and bookmark navigation to a proxy URL, which the isolation headers already make harmless. A missing header means a non-browser client, or a very old browser, and is not rejected here; the per-client limit covers those. The header is set by the browser and cannot be forged by a web page, but any script outside a browser can send whatever it likes, so this check stops cross-site embedding and not scripted use.

### Limits

Request patterns derived from the client:

- **Feed refresh.** `refreshStaleFeeds` issues exactly one `/feed` request per feed, with no retries, through `mapConcurrent(..., 4)`. The number of requests in a window is bounded by the number of feeds, not by speed. A full refresh of the 500 feeds that server polling supports is 500 requests. Cache hits return in tens of milliseconds, so those 500 requests can arrive within 10 to 15 seconds, which is why a 10-second period would be too tight. An OPML import calls `refreshFeeds` once for all imported feeds, so a 1000-feed import is 1000 requests.
- **Households.** Several devices behind one address can each force a refresh within the same minute, and a user can repeat a manual refresh.
- **Articles.** Opening an article is one `/article` request. Adding a feed by page URL adds at most one more. Both are user-paced.
- **Images.** The client rewrites every `img` in extracted HTML to `/img?url=` and the browser requests them all at once. Responses are immutable for 30 days, so a repeat view costs nothing. A photo essay can have 100 to 200 images. The origin governor already limits bursts to a single image host to a handful per five seconds.

Chosen limits, per client address in a 60-second window:

| Budget | Endpoints | Limit | Margin |
| --- | --- | --- | --- |
| fetch | `/feed`, `/article` | 2000 | 4 full refreshes of 500 feeds, or a 1000-feed import plus a 500-feed refresh |
| image | `/img` | 600 | 3 articles of 200 images, or 6 of 100 |

The feed and article budget is shared because both are server-side fetches of pages and are user-paced outside refreshes. Images have their own budget so an image-heavy article cannot starve a refresh, and a refresh cannot starve images. Sixty seconds is used instead of Cloudflare's other supported period, 10 seconds, because a 10-second window would have to be sized for the fastest possible burst and would either reject real refreshes or be too generous to mean anything.

A client that is limited recovers without intervention: the browser already stores a `429` `Retry-After` and retries after it, and existing feeds with recent data show no error for transient failures. Feeds that have never been fetched, such as an import that exceeds the budget, show an error until the retry time.

The limits are set so they do not interfere with real use and still bound a single source to about 33 fetches or 10 images a second. A source over that is more likely a script than a person.

Responses served from the shared feed cache count. A cache hit still costs a Worker invocation, which is what the limit protects, and counting them before the cache lookup keeps the guard independent of the cache.

### Enforcement

- **Workers with the binding.** Two `[[ratelimits]]` bindings in `wrangler.toml`, `PROXY_FETCH_LIMITER` and `PROXY_IMAGE_LIMITER`, each `period = 60` and with the limits above. Cloudflare supports periods of 10 or 60 seconds only, one limit per binding, and counts per Cloudflare location with eventual consistency, so enforcement is permissive: a client served from several locations can exceed the budget somewhat, and it can be admitted briefly after exceeding it. That is acceptable for abuse bounding. The binding does not expose a reset time, so `Retry-After` is the full period (60 seconds), an upper bound. Cloudflare's guidance discourages IP addresses as keys because many users can share one. This design accepts that, and the limits are sized for a household, not a person. Namespace IDs must be unique per account and are shared across Workers that reuse them, so `wrangler.toml` uses `7301` and `7302`; an operator whose account already uses those IDs must change them.
- **Without the binding, and on Node and Bun.** A process-local fixed-window limiter with the same budgets and a bounded key table (10 000 keys per budget; expired windows are swept first, then the oldest keys are dropped). It is used when the binding is absent, which covers local development, tests and a Worker deployed without the binding, and when a binding call throws. The binding is never consulted together with the local limiter, to avoid double counting. The D1 fixed-window limiter in `server/sync/ratelimit.ts` is not used because it writes to D1 on every request.

### Client address

- **Workers:** `CF-Connecting-IP`, which Cloudflare sets and overwrites.
- **Node and Bun:** the socket address, through the Hono connection-info helper. `X-Forwarded-For` is ignored unless `TRUST_PROXY_HOPS` is set to a positive integer, in which case the entry that many places from the right is used (1 for a single reverse proxy), falling back to the socket address when the header has too few valid entries. Taking the entry from the right means a client cannot choose it by prepending entries. Behind a reverse proxy or Docker network address translation without this setting, every client shares one budget, which is generous enough for a self-hosted instance.
- **Development server:** the Vite middleware passes the Node request to the app so the socket address is available.
- **No usable address:** requests share a single `unknown` key.
- IPv4-mapped IPv6 addresses are keyed as IPv4, and IPv6 addresses by their /64 prefix, so a client that rotates addresses within its prefix does not get a new budget.

### Body caps

`/feed` is capped at 2 MiB, `/article` at 5 MiB and `/img` at 10 MiB. The feed cap matches the cache limit and prevents `/feed` from acting as an uncapped response relay. Article and image caps allow large pages and high-resolution photographs while bounding each request.

A declared `Content-Length` over the cap cancels the upstream body without reading it and returns `502` with `Cache-Control: no-store`. For an undeclared or misleading length, `/feed` reads only while the accumulated body remains within 2 MiB; the cache never receives an oversized body. Article and image bodies are piped through a `TransformStream` that counts bytes and errors the stream when the cap is crossed, which cancels the upstream read. A body exactly at its cap is delivered.

The count is of bytes after any content decoding, so a compressed response that expands is bounded too, while the declared length applies to whatever the upstream sent.

Error responses from all proxy routes are also streamed through their route's cap so an upstream error cannot be used to relay an unbounded body.

### Sync client address

Sync's IP-based limits run on Workers. Cloudflare sets `CF-Connecting-IP` from the connection and overwrites a caller-supplied value. `X-Forwarded-For` is not authoritative because callers can send it themselves. Sync limits therefore use `CF-Connecting-IP` only and fall back to a shared key if Cloudflare's address is absent. Node and Bun do not mount sync routes.

### Diagnostics

Rejections emit a structured `console.info` line, `upstream_policy.client_rejected`, through the same diagnostic helper as the origin governor, with only the route, status, reason (`cross_site` or `rate_limited`), source, the limiter in use (`binding` or `local`) and `retryAfterMs`. There is no origin hash because the target has not been parsed, and no client address or URL. To stop a flood from becoming a log flood, each route and reason is logged at most once every 10 seconds per runtime with a count of suppressed rejections.

## Risks / Trade-offs

- **A per-IP limit does not stop a distributed caller.** It bounds a single source. Operators should set a Cloudflare billing alert (documented in the README).
- **Permissive binding.** Counters are per location and eventually consistent, so the effective limit varies. Margins in the limits absorb this.
- **Shared addresses.** Carrier-grade NAT and offices can put many users behind one address. The budgets allow several concurrent heavy users, but a large shared address can hit them.
- **Large feeds.** Feeds over 2 MiB now fail instead of being passed through uncached. This can exclude unusually large feeds, while keeping proxy memory bounded.
- **Response cloning.** Request coalescing clones upstream responses, and the unread branches of a cloned stream can retain chunks. The cap bounds this to a small multiple of the cap, but it does not remove it.
- **Namespace ID collisions.** Reusing a rate limiting namespace ID within an account shares counters. The IDs here are arbitrary and may need to change.
- **Not verified against Cloudflare.** The binding is exercised only through a stub in tests. The deployed Worker must be checked after merge.

## Migration

Forward-only. Adding the `ratelimits` bindings to `wrangler.toml` takes effect on the next deploy. Wrangler 4.36 or later is required and the repository uses 4.131. No data changes and no client changes.
