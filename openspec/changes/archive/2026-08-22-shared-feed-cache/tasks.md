## 1. Cache Core

- [x] 1.1 Add bounded runtime-local feed cache state keyed by the complete validated upstream URL, with 15-minute freshness and LRU eviction.
- [x] 1.2 Add cache entry construction and response helpers that preserve feed bytes, ETag, Last-Modified, Age, and cache outcome metadata.
- [x] 1.3 Add per-URL in-flight revalidation coalescing and rate-limit suppression with Retry-After parsing, fallback, and 24-hour cap.

## 2. Proxy Integration

- [x] 2.1 Route `/feed` through the shared cache while keeping `/article`, `/img`, and sync routes unchanged.
- [x] 2.2 Separate client conditional headers from cache validators and preserve correct 200/304 behavior for fresh hits and revalidated entries.
- [x] 2.3 Preserve passthrough behavior for non-cacheable successful responses, non-2xx responses, and transport failures.

## 3. Verification

- [x] 3.1 Add tests for exact URL/query-key isolation, fresh-hit bypass, 15-minute expiry, and non-sliding expiry.
- [x] 3.2 Add tests for per-client ETag/Last-Modified handling and shared-validator upstream revalidation.
- [x] 3.3 Add tests for concurrent request coalescing, 429 Retry-After suppression, fallback cooldown, and cache metadata headers.
- [x] 3.4 Run `npm run typecheck`, `npm run lint`, and `npm test`.

## 4. Documentation

- [x] 4.1 Update README proxy/privacy or deployment text to describe the runtime-local best-effort feed response cache and its 15-minute freshness window.
