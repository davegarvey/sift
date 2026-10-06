## Why

The `/feed`, `/article` and `/img` endpoints fetch any public URL for any caller. Existing controls protect upstream sites and private networks: target validation, redirect revalidation, timeouts, per-origin spacing and concurrency, and shared cooldowns. Nothing limits an individual client, checks that a request comes from Sift itself, or caps `/article` and `/img` body sizes. Now that the hosted instance is public, the proxy can be used as a general fetcher or free image host, which costs Worker requests and CPU time and risks the domain being associated with content Sift did not choose to serve. Cloudflare does not charge Workers for egress bandwidth, so the main exposures are request volume, CPU time and the domain's reputation, not bandwidth.

## What Changes

- Reject browser requests to the proxy endpoints whose `Sec-Fetch-Site` is present and not `same-origin`, so other websites cannot embed or call the proxy. Requests without the header (non-browser clients) are not rejected on this basis; the per-client limit covers them.
- Add a per-client request limit on the proxy endpoints, keyed by client IP address, returning `429` with `Retry-After`. On Workers, prefer Cloudflare's rate limiting binding over the D1 fixed-window limiter, to avoid a D1 write per proxy request; Node and Bun use a process-local limiter.
- Cap `/article` and `/img` response bodies, rejecting declared oversize responses before reading and aborting streamed bodies that exceed the cap. Caps should reflect real articles and images, for example 5 MiB for articles and 10 MiB for images.
- Record limit rejections in the existing hashed diagnostics without logging client IPs or upstream URLs.
- Document a recommended Cloudflare billing alert for operators in the README.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `secure-upstream-fetch`: same-site enforcement, per-client limits and response size caps for proxy endpoints.
- `upstream-request-governance`: interaction between per-client limits and existing per-origin governance, so a limited client does not consume origin slots.

## Impact

`server/handle.ts`, `server/fetch.ts`, `server/worker.ts` and `wrangler.toml` (rate limiting binding), `server/node.ts` and `server/bun.ts`, tests and README. The browser client already uses same-origin requests, so it needs no change. `siftctl` fetches feeds directly rather than through the proxy, and MCP fetches server-side, so neither is affected by the same-site check.

## Open questions

- The per-IP limits. They must allow a large OPML import and a full refresh of several hundred feeds from one household behind one IP address, while stopping bulk use. Measurements from the current client's refresh pattern should set them.
- Whether `/feed` responses served from the shared feed cache should count towards the per-client limit.

## Non-goals

Authentication or API keys for the proxy, CAPTCHAs or Turnstile, allowlists of permitted upstream domains, and changes to the existing target and redirect policy.
