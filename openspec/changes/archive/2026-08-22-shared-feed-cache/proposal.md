## Why

The browser refreshes feeds through the shared `/feed` proxy, so multiple users and devices can independently generate upstream requests for the same public feed URL. Conditional requests reduce response size but still count toward upstream rate limits, increasing the chance of `429 Too Many Requests` responses. A short-lived server-side response cache can share the same feed representation across requests without moving feed parsing, items, or sync state out of the browser.

## What Changes

- Add shared caching for successful `/feed` responses, keyed by the complete upstream URL including meaningful query parameters.
- Keep the cache representation separate from each client’s conditional headers; use the cached validators for upstream revalidation and the requesting client’s validators for its final `200` or `304` response.
- Use a 15-minute freshness window. Cache hits SHALL NOT extend the expiry; upstream `200` and `304` responses reset it.
- Coalesce concurrent revalidations for the same URL so one cache expiry does not create an upstream request burst.
- Preserve existing `Retry-After` behavior and add short-lived per-URL suppression after an upstream `429` without replacing a cached feed body with an error response.
- Return cache age and optional cache outcome metadata through response headers for diagnostics; the browser scheduler SHALL remain correct when it ignores those headers.
- Keep feed XML parsing, item storage, read/starred state, and sync behavior browser-local.
- Preserve current passthrough behavior for non-feed endpoints and unsuccessful feed responses.

## Capabilities

### New Capabilities

- `shared-feed-cache`: Shared, URL-scoped caching and upstream revalidation for public feed responses, including validator handling, expiry, request coalescing, and rate-limit suppression.

### Modified Capabilities

<!-- No existing capability requirements are being modified. -->

## Impact

- `server/handle.ts` and `server/fetch.ts`: cache lookup, response metadata, conditional revalidation, and per-URL cooldown state.
- `src/feeds/fetch.ts`: consume any changed response semantics without making cache age a prerequisite for refresh correctness.
- Feed proxy tests: cache hits, expiry, validator separation, concurrent requests, and `429` cooldown behavior.
- README and deployment documentation: describe the cache as a best-effort server-side optimization and clarify that Node/Bun and Worker runtimes may differ in cache lifetime and scope.
- No database migration, sync schema change, new dependency, or server-side feed/item storage.
