## Why

The completed `shared-feed-cache` change uses runtime-local memory, which is effective for a single Node/Bun process but ephemeral and isolate-local on Cloudflare Workers. Using the Workers Cache API for the cached feed representation can preserve successful feed responses across Worker isolate lifetimes and improve reuse within a Cloudflare data center without adding a database or changing sync.

## What Changes

- Use the Cloudflare Workers Cache API as the Worker-side store for successful `/feed` representations when the runtime provides it.
- Preserve the existing in-memory cache as the Node/Bun implementation and as a fallback when the Cache API is unavailable or rejects an entry.
- Keep complete upstream URL identity, including meaningful query parameters, in the Cache API key.
- Store and restore feed bytes, ETag, Last-Modified, freshness, and cache-age metadata through the Cache API response representation.
- Continue using runtime-local in-flight request coalescing and rate-limit suppression; this change SHALL NOT introduce global locking or claim cross-data-center coordination.
- Keep external `/feed` responses `no-store` while using cacheable headers only on the internal Cache API representation.
- Add Worker-compatible tests for Cache API hits, misses, expiry, validator revalidation, cache write failures, and fallback behavior.
- Update deployment/privacy documentation to distinguish persistent edge-cache reuse from D1 sync storage and to record the Free-plan usage implications.

## Capabilities

### New Capabilities

- `cloudflare-feed-cache`: Worker-side persistence of shared feed representations through the Cloudflare Cache API with graceful fallback to the existing runtime-local memory cache.

### Modified Capabilities

<!-- No existing main capability requirements are modified; this is a follow-up implementation capability for the shared feed cache. -->

## Impact

- `server/fetch.ts`: introduce a cache-store boundary and Cloudflare Cache API adapter while preserving Node/Bun behavior.
- `server/worker.ts` and `wrangler.toml`: verify Worker runtime compatibility; no D1 schema change or new storage binding is expected.
- Feed proxy tests: cover Cache API semantics, exact URL keys, internal TTL metadata, and fallback on unavailable/failing cache operations.
- `README.md`: document that Worker Cache API reuse is data-center-local/best-effort, does not make the cache globally coordinated, and still consumes Worker request quota on cache hits.
- No changes to feed parsing, IndexedDB, sync payloads, article/image proxy behavior, or user-visible refresh controls.
