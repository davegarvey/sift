## Why

The `/feed`, `/article` and `/img` endpoints fetch any public URL for any caller. Existing controls protect upstream sites and private networks: target validation, redirect revalidation, timeouts, per-origin spacing and concurrency, and shared cooldowns. Nothing limits an individual client, checks that a request comes from Sift itself, or caps `/article` and `/img` body sizes. Now that the hosted instance is public, the proxy can be used as a general fetcher or free image host, which costs Worker requests and CPU time and risks the domain being associated with content Sift did not choose to serve. Cloudflare does not charge Workers for egress bandwidth, so the main exposures are request volume, CPU time and the domain's reputation, not bandwidth.

## What Changes

- Reject browser requests to the proxy endpoints whose `Sec-Fetch-Site` is present and not `same-origin`, so other websites cannot embed or call the proxy. Requests without the header (non-browser clients) are not rejected on this basis; the per-client limit covers them.
- Add a per-client request limit on the proxy endpoints, keyed by client IP address, returning `429` with `Retry-After`. On Workers, prefer Cloudflare's rate limiting binding over the D1 fixed-window limiter, to avoid a D1 write per proxy request; Node and Bun use a process-local limiter.
- Cap `/feed`, `/article` and `/img` response bodies, rejecting declared oversize responses before reading and aborting streamed bodies that exceed the cap. Use 2 MiB for feeds, 5 MiB for articles and 10 MiB for images.
- Use only Cloudflare's trusted `CF-Connecting-IP` header when `/sync` applies IP-based rate limits; ignore `X-Forwarded-For`, which callers can supply themselves.
- Record limit rejections in the existing hashed diagnostics without logging client IPs or upstream URLs.
- Document a recommended Cloudflare billing alert for operators in the README.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `secure-upstream-fetch`: same-site enforcement, per-client limits and response size caps for proxy endpoints.
- `upstream-request-governance`: interaction between per-client limits and existing per-origin governance, so a limited client does not consume origin slots.
- `device-sync`: IP-based sync limits use only Cloudflare's trusted client address, not a caller-supplied forwarded header.

## Impact

`server/handle.ts`, `server/fetch.ts`, `server/body-cap.ts`, `server/sync/auth.ts`, `server/worker.ts` and `wrangler.toml` (rate limiting binding), `server/node.ts` and `server/bun.ts`, tests and README. The browser client already uses same-origin requests, so it needs no change. `siftctl` fetches feeds directly rather than through the proxy, and MCP fetches server-side, so neither is affected by the same-site check.

## Decisions

- Use 2000 `/feed` and `/article` requests and 600 `/img` requests per client per 60 seconds. This allows four refreshes of 500 feeds, or an import of 1000 feeds plus a 500-feed refresh, from one household. Images have their own budget so they cannot starve feed refreshes.
- Count shared-cache hits because each still costs a Worker request.
- Cap feed bodies at the existing 2 MiB cache limit, article bodies at 5 MiB and image bodies at 10 MiB.
- For sync IP limits, trust only Cloudflare's `CF-Connecting-IP`; when absent, use a shared fallback rather than a caller-supplied forwarded header.

## Non-goals

Authentication or API keys for the proxy, CAPTCHAs or Turnstile, allowlists of permitted upstream domains, and changes to the existing target and redirect policy.
