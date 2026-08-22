## Context

The browser scheduler currently calls the stateless `/feed` proxy and stores feed XML-derived items in IndexedDB. It already persists upstream ETags and Last-Modified values, but conditional requests still count toward upstream rate limits. The sync service intentionally stores subscriptions and item flags only; it does not store feed XML or item content.

The proposal and `shared-feed-cache` requirements define the externally visible behavior. This design keeps the cache as a small optimization around the existing proxy rather than introducing server-side feed parsing or a hosted item database.

## Goals / Non-Goals

**Goals:**

- Deduplicate requests for the same complete feed URL within one running server instance.
- Preserve correct per-client `200`/`304` behavior while using one shared upstream validator.
- Bound memory, cache age, and repeated upstream attempts after a `429`.
- Provide enough response metadata to diagnose cache behavior without changing browser scheduling.
- Keep Node, Bun, and Worker deployments on the same implementation with runtime-local best-effort scope.

**Non-Goals:**

- A globally coordinated cache across Cloudflare edge locations.
- Server-side feed parsing, item storage, or cross-device item synchronization.
- Caching article HTML, images, sync responses, failures, or rate-limit bodies.
- A background server scheduler that fetches feeds without an active browser request.
- Adaptive per-feed TTL learning in the first version.

## Decisions

### Decision 1: Runtime-local in-memory cache

Use module-level maps in the shared server fetch module. Node and Bun get a process-local cache; a Worker gets best-effort cache state within the running isolate. This avoids D1, KV, R2, Durable Objects, and new dependencies while fitting the existing adapter-independent fetch path.

**Alternative considered:** Cloudflare Durable Objects or an external cache. Rejected for the first version because they add deployment-specific state and coordination that are not required to validate whether a 15-minute shared representation cache reduces 429s.

### Decision 2: Cache complete URL identity

Use the canonical URL returned by existing upstream validation as the cache key, retaining query parameters. The proxy does not forward browser cookies or authorization headers, so the response variation model remains URL plus the fixed Sift user agent and upstream time/IP behavior.

**Alternative considered:** Hostname/path-only keys. Rejected because feeds can use query parameters to select different users or representations, and collapsing them would risk cross-contamination.

### Decision 3: Store bytes plus validators, not Response objects

Read successful upstream feed bodies into bounded byte arrays and reconstruct a new `Response` for each client. This avoids consuming a one-shot stream and allows multiple waiting clients to receive independent bodies. Store `ETag`, `Last-Modified`, and the upstream fetch timestamp alongside the bytes.

Only successful `200` responses under a fixed body-size limit are cached. Responses with `Set-Cookie`, `Vary: *`, partial status, or oversized bodies bypass the cache and retain passthrough behavior.

### Decision 4: Separate upstream revalidation from client conditional handling

On a stale entry, a single revalidation uses the entry's ETag and Last-Modified. After the upstream result is available, each request applies its own conditional headers to the cached representation. A fresh cache hit never sends a client's validator upstream.

This prevents one client's old or unrelated validator from affecting another client's response while retaining normal HTTP cache semantics.

### Decision 5: Fixed 15-minute freshness and bounded LRU

Set freshness to 15 minutes from upstream `200` or `304` activity. Hits do not change the timestamp. Limit the number of entries and maximum body size with constants in the fetch module; evict the least-recently-used entries when the count limit is reached. These limits prevent an arbitrary collection of feed URLs from growing process memory without requiring a storage subsystem.

**Alternative considered:** Use each browser's learned interval. Rejected because the server does not know every client's interval, and a fixed shared policy is easier to reason about and measure.

### Decision 6: Per-URL in-flight and rate-limit state

Maintain one in-flight revalidation promise per URL. On upstream `429`, retain any old successful entry and record a per-URL `retryAt` using a parsed `Retry-After`, capped at 24 hours. Missing or invalid values use a 30-minute fallback. During suppression, return a local `429` without contacting upstream.

Do not serve a stale entry as `200` during suppression in the first version. That would require teaching the browser scheduler to distinguish stale successful content from a successful fresh fetch. Existing client-side backoff already handles the returned `429`.

### Decision 7: Diagnostic headers are advisory

Return `Age` on successful responses and an `X-Sift-Cache` outcome header for diagnostics. Keep the browser's refresh algorithm unchanged; `lastFetched` continues to mean the last successful proxy response from that device. Cache freshness is enforced by the server independently.

### Decision 8: Preserve external browser cache behavior

Keep the existing `Cache-Control: no-cache, no-store` response policy for the browser while the cache is implemented inside the proxy. This avoids adding a second browser/CDN cache layer whose force-refresh and regional behavior would be harder to reason about. The shared cache is an origin-fetch optimization, not a public HTTP cache contract in this version.

## Risks / Trade-offs

- **[Risk] Worker cache state is not globally shared** → Document the cache as runtime-local best effort; measure impact before considering Durable Objects or another shared store.
- **[Risk] A URL containing a bearer token can persist in process memory with its response** → Preserve the complete URL identity and never log cache keys; do not forward or expose cookies. A later hardening change can add cache eligibility policy without changing key correctness.
- **[Risk] Fifteen minutes of shared freshness can delay feed changes** → Bound the delay explicitly and retain the existing manual refresh path; increase or decrease the constant based on observed 429 and freshness metrics.
- **[Risk] A shared 429 cooldown affects all users of the exact URL in that runtime** → Honor upstream Retry-After, cap it, and keep the previous body for the next successful revalidation rather than caching an error body.
- **[Risk] In-memory cache disappears on restart** → Treat misses after restart as normal; no user data or correctness depends on cache persistence.
- **[Risk] One upstream fetch can consume substantial memory** → Apply fixed entry-count and response-size bounds and bypass caching for oversized responses.
- **[Risk] Existing `lastFetched` merging uses sync row timestamps** → Do not make cache behavior depend on sync metadata; retain this as a separate existing sync scheduling concern.

## Migration Plan

1. Add the cache capability and focused proxy tests.
2. Deploy normally; cache starts empty and warms on demand.
3. Observe cache outcomes, upstream status rates, and memory behavior without logging raw URLs.
4. Roll back by removing the cache path; browser-local feeds and sync data remain valid because the cache is not authoritative.

## Open Questions

None blocking for this first version.
