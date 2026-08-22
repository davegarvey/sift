## Context

The completed `shared-feed-cache` change stores feed bodies and validators in module-level memory. That works for a single Node/Bun process, but a Worker isolate can be replaced and Cloudflare can execute the Worker in multiple cache locations. The follow-up preserves the existing cache contract and adds a Worker-specific backing store.

Cloudflare's Workers Cache API stores `Response` objects, honors response cache directives, and can evaluate ETag and Last-Modified validators. Its contents are data-center-local and `cache.put`/`cache.match` do not provide global replication or stale-while-revalidate. The design therefore uses it for persistence and regional reuse, not global coordination.

## Goals / Non-Goals

**Goals:**

- Preserve successful feed bodies across normal Worker isolate replacement in a cache location.
- Reuse Cloudflare's response cache semantics without changing browser-visible cache policy.
- Keep one cache implementation contract across Worker, Node, and Bun runtimes.
- Fall back to the existing memory cache when the API is absent or unreliable.
- Avoid new D1, KV, R2, or Durable Object bindings for this incremental improvement.

**Non-Goals:**

- Global cache replication or one upstream request worldwide.
- Persistent global `429` cooldown state.
- Using the Cache API as a user-data store or sync database.
- Enabling browser or public CDN caching of `/feed` responses.
- Changing the 15-minute freshness window or browser refresh behavior.

## Decisions

### Decision 1: Add a cache-store boundary

Separate representation lookup/store operations from feed revalidation policy. The memory implementation remains the default portable store. A Worker implementation delegates successful representation storage to `caches.default` when available.

**Alternative considered:** Put `if (caches.default)` branches throughout `/feed` handling. Rejected because it would duplicate validator, expiry, and fallback logic and make Node/Bun behavior harder to test.

### Decision 2: Use a GET Request keyed by the validated upstream URL

Create a GET cache key from the complete validated upstream URL. The key request has no client conditional headers, so validators do not fragment representation identity. Client conditional headers continue to be evaluated by the common feed-response logic after the representation is loaded.

**Alternative considered:** Use the incoming `/feed?url=` request as the Cache API key. Rejected because the proxy URL includes Sift routing details and client conditionals; the upstream URL is the actual representation identity.

### Decision 3: Store an internal cache response with explicit metadata

When putting a representation into the Worker Cache API, create an internal response containing the feed bytes, ETag, Last-Modified, `Cache-Control: public, max-age=900`, and a private implementation metadata header containing the upstream fetch timestamp. The normal `/feed` route continues to construct an external response with `Cache-Control: no-cache, no-store`, so browser caching policy remains unchanged.

The metadata header is consumed by the cache adapter to reconstruct age after in-memory state is lost and is not copied to the browser response. The existing `Age` and `X-Sift-Cache` diagnostics remain the only cache metadata exposed externally.

### Decision 4: Read without client conditionals

The cache adapter first looks up the representation with a bare GET key. It does not pass the browser's `If-None-Match` or `If-Modified-Since` into the Cache API lookup, because the common response layer must apply those validators consistently across memory and Worker stores. This also avoids treating a cache-generated `304` as an upstream revalidation result.

### Decision 5: Keep memory as a write-through and failure fallback

On a successful upstream response or `304` revalidation, update the memory entry and attempt to update the Worker Cache API. If the Cache API operation throws or rejects, return the upstream result and leave memory available. On a Cache API hit, populate the memory entry opportunistically for subsequent requests in the same isolate.

**Alternative considered:** Make Cache API success mandatory on Workers. Rejected because cache storage is an optimization and its failure must not turn a feed fetch into a gateway error.

### Decision 6: Keep regional limitations explicit

Do not add KV or Durable Objects in this change. KV would add eventual-consistency and write-usage behavior without guaranteeing single-flight revalidation. Durable Objects would solve stronger global per-key coordination but require a new class, binding, naming scheme, and request hop. Both remain possible follow-ups if measurements show regional Cache API reuse is insufficient.

### Decision 7: Free-plan behavior is documented, not feature-gated

The Cache API itself does not require a paid storage binding. Worker requests, including requests that still invoke the Worker to perform a Cache API lookup, remain subject to the account's Worker request limits. The implementation does not add KV/Durable Object usage or a new billing dependency.

## Risks / Trade-offs

- **[Risk] Cache API is unavailable or behaves differently in a local preview/runtime** → Feature-detect it, retain memory fallback, and test the store through a small injectable/fake interface.
- **[Risk] Cache API entries are regional rather than global** → Document the limitation and retain local in-flight coordination; do not claim global deduplication.
- **[Risk] Cache API metadata is missing or malformed** → Treat the entry as a cache miss or age zero, then revalidate safely; never fail the feed solely because diagnostics are unavailable.
- **[Risk] Internal cache directives leak into browser behavior** → Construct a separate external response and continue returning `no-cache, no-store` to clients.
- **[Risk] Cache API write errors occur after a successful upstream fetch** → Return the successful response and keep the memory entry; cache persistence is opportunistic.
- **[Risk] Cache API storage is evicted before 15 minutes** → Treat eviction as a normal miss; correctness remains based on upstream fetch and browser-local data.
- **[Risk] Free-plan Worker request limits are still reached** → Clarify that this change targets upstream feed `429`s, not the inbound Worker request quota.

## Migration Plan

1. Add the cache-store abstraction and Worker Cache API adapter.
2. Deploy without a migration; existing memory entries warm the Worker cache on successful fetches.
3. Observe `X-Sift-Cache` outcomes and upstream status rates by runtime without logging feed URLs.
4. Roll back by disabling the Worker adapter or reverting the change; memory caching and browser-local state remain valid.

## Open Questions

None blocking. A future change may evaluate Durable Objects if regional misses continue to cause unacceptable upstream rate limits.
