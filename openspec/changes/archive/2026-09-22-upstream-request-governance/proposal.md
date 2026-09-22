## Why

Sift has received upstream `429` responses and a `419` from a feed origin. The current protections limit repeated requests for the same feed URL, but they do not control aggregate traffic to an origin across URLs, proxy routes, Worker isolates, or Cloudflare data centers; the client refresh cadence can also become unnecessarily aggressive for feeds with many entries.

## What Changes

- Base learned refresh cadence on genuinely new entries observed over elapsed time, and stagger background refreshes without scheduling them before the learned interval.
- Add one origin-scoped request policy for feed, article, image, discovery, and MCP upstream requests, including redirect hops. Use D1-backed atomic reservations and origin cooldowns in the Worker deployment, with runtime-local fallback elsewhere.
- Apply upstream `Retry-After` consistently, prevent manual refresh from bypassing an active upstream cooldown, and use a longer progressive cooldown for `419` challenge responses.
- Mark proxy failures as non-cacheable and preserve successful feed representations separately from cooldown markers.
- Add privacy-safe diagnostics that distinguish upstream failures from Sift cooldown responses without logging raw URLs.

The `419` response alone does not establish whether it came from the origin or an intermediary, or what caused it. This change applies the same request policy to every origin and does not add provider-specific fetch paths or header overrides.

## Capabilities

### New Capabilities

- `upstream-request-governance`: Refresh cadence, origin request pacing, cooldowns, and safe upstream diagnostics across Sift's fetch paths.

### Modified Capabilities

- `shared-feed-cache`: Keep successful feed representations when Worker cooldown state is recorded.
- `shared-feed-failure-cooldown`: Add origin-wide cooldowns for rate-limit and challenge responses.
- `cloudflare-feed-cache`: Coordinate per-origin request reservations through D1 while retaining data-center-local response caching.

## Impact

- Browser scheduler and retry handling in `src/feeds/scheduler.ts` and `src/feeds/fetch.ts`.
- Shared fetch policy and proxy routes in `server/fetch.ts`, `server/handle.ts`, and `server/mcp.ts`.
- Hashed D1 origin state, migrations, and scheduled cleanup.
- Existing feed-cache and failure-cooldown specifications, tests, and README privacy/cache description.
