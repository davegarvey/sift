## Why

The hosted Worker can receive an upstream failure such as HTTP 419 even when
the same feed is available to a normal client. The current failure suppression
is runtime-local, so requests from other Worker isolates or users can continue
probing the same unavailable upstream and add avoidable load.

## What Changes

- Add a generic `/feed` failure-cooldown capability for upstream `4xx`/`5xx`
  responses and network failures.
- Share failure status and retry timing through D1 using a one-way hash of the
  complete validated upstream URL; never persist the raw URL or feed body in
  this state.
- Honor a usable upstream `Retry-After`, capped at 24 hours, and use a
  30-minute default when it is absent or unusable.
- Keep in-memory and Worker Cache API suppression as local fast paths, with D1
  as the cross-user/isolated-Worker fallback when available.
- Remove failure state after a later successful fetch and prune expired D1
  rows from the existing daily cleanup.
- Preserve successful feed representation caching, validator handling,
  browser-local parsing, and Node/Bun operation without D1.
- Do not add feed-specific fallbacks, redirect behavior, server-side feed
  parsing, or feed XML storage in D1.

## Capabilities

### New Capabilities

- `shared-feed-failure-cooldown`: Generic cross-user suppression of repeated
  upstream feed failures while preserving the existing successful-feed cache.

### Modified Capabilities

- `shared-feed-cache`: Extend repeated-upstream suppression from only `429` to
  all upstream failure responses covered by the new capability.
- `cloudflare-feed-cache`: Allow shared D1 failure metadata while keeping feed
  representations out of D1 and successful-body caching data-center-local.

## Impact

- `server/fetch.ts` and `server/handle.ts` gain shared failure-state lookup and
  recording around `/feed` revalidation.
- `server/feed-state.ts` and a D1 migration add hashed failure metadata.
- `server/sync/cron.ts` removes expired failure records; sync payloads and
  user-scoped tables remain unchanged.
- The local D1 shim and feed-cache tests cover the new state path.
- README and migration documentation describe the shared failure metadata and
  its privacy boundary.
