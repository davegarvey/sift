# cloudflare-feed-cache Specification

## Purpose

This capability improves feed-cache reuse on Cloudflare Workers without introducing persistent application storage, global coordination, or changes to Sift's browser-local and sync data model.

## Requirements

### Requirement: Use the Worker Cache API when available

The Worker deployment SHALL use the Cloudflare Cache API as the backing store for successful `/feed` representations when the runtime exposes a usable default cache. The existing runtime-local memory cache SHALL remain available as a fallback and SHALL continue to serve Node/Bun deployments.

#### Scenario: Worker Cache API hit survives isolate replacement

- **WHEN** a successful feed representation has been stored in the Worker Cache API
- **AND** a later request reaches a new Worker isolate in the same cache location before the representation expires
- **THEN** the proxy SHALL be able to serve the cached representation without requiring the in-memory cache from the previous isolate

#### Scenario: Node deployment retains memory behavior

- **WHEN** the server runtime does not expose the Worker Cache API
- **THEN** the proxy SHALL use the existing runtime-local memory cache
- **AND** `/feed` behavior SHALL remain available without a Cloudflare storage binding

### Requirement: Preserve complete URL identity in the Worker cache

The Worker Cache API key SHALL preserve the complete validated upstream feed URL, including meaningful query parameters. The key SHALL be a GET cache key and SHALL not include per-client conditional headers as part of representation identity.

#### Scenario: Query-specific feed representations remain isolated

- **WHEN** two `/feed` requests contain distinct validated upstream query URLs
- **THEN** the Worker cache SHALL use distinct representations
- **AND** a hit for one query URL SHALL not return the other query URL's body

#### Scenario: Client validators do not fragment the Worker cache

- **WHEN** two clients request the same upstream URL with different `If-None-Match` values
- **THEN** both requests SHALL address the same Worker cache representation
- **AND** each client SHALL still receive its own correct `200` or `304` response

### Requirement: Keep internal cache policy separate from browser policy

The representation stored in the Worker Cache API SHALL carry an internal 15-minute freshness policy and enough metadata to reconstruct `Age`, ETag, and Last-Modified behavior. The externally returned `/feed` response SHALL retain Sift's `Cache-Control: no-cache, no-store` policy.

#### Scenario: Cache API expiry is independent of browser caching

- **WHEN** a Worker stores a successful feed representation
- **THEN** the Worker Cache API representation SHALL expire after 15 minutes from upstream activity
- **AND** the response returned to the browser SHALL not become a browser-persistent shared cache entry solely because of the internal cache policy

#### Scenario: Cache age is restored after in-memory loss

- **WHEN** a cached representation is read from the Worker Cache API after the in-memory state was lost
- **THEN** the proxy SHALL derive its cache age from stored metadata
- **AND** the returned response SHALL expose the same non-authoritative cache diagnostics as an in-memory hit

### Requirement: Fall back safely when Cache API operations fail

Cache API availability, read, and write failures SHALL not make `/feed` unavailable. A failed cache read SHALL proceed to upstream revalidation, and a failed cache write SHALL still return the successful upstream response while retaining any runtime-local cache state that can be used.

#### Scenario: Cache API write failure does not fail the feed request

- **WHEN** upstream returns a cacheable successful feed but the Worker Cache API rejects the write
- **THEN** `/feed` SHALL return the successful feed response
- **AND** the proxy SHALL retain or use the runtime-local fallback where possible

#### Scenario: Cache API is unavailable outside Workers

- **WHEN** the runtime does not provide `caches.default`
- **THEN** the proxy SHALL not attempt a Worker-specific cache operation
- **AND** the existing memory-cache path SHALL handle the request

### Requirement: Preserve runtime-local coordination boundaries

The Worker Cache API enhancement SHALL not claim global cache replication or global request serialization. In-flight revalidation and `429` suppression SHALL remain runtime-local, and a cache miss in another Cloudflare data center MAY perform its own upstream request.

#### Scenario: Cache locations miss independently

- **WHEN** the same feed representation is absent from two Cloudflare cache locations
- **THEN** each location MAY perform one local revalidation
- **AND** the proxy SHALL continue to return correct feed representations without treating the locations as a single strongly consistent cache

#### Scenario: Rate-limit state remains local

- **WHEN** one Worker runtime records a per-URL `Retry-After` cooldown
- **THEN** requests handled by that runtime SHALL honor the cooldown
- **AND** this capability SHALL not require the cooldown to be globally visible through sync or persistent application storage

### Requirement: Keep storage and endpoint boundaries unchanged

The Worker Cache API SHALL store only cacheable `/feed` representations and their cache metadata. It SHALL not store sync payloads, user reading state, parsed items, article HTML, or image responses.

#### Scenario: Feed cache does not alter sync data

- **WHEN** a feed response is stored in the Worker Cache API
- **THEN** the response body SHALL not be added to D1 sync tables or sync payloads
- **AND** browser-local parsing and item storage SHALL remain the source of feed items

#### Scenario: Article and image routes do not use the feed cache

- **WHEN** a request targets `/article` or `/img`
- **THEN** the Worker Cache API feed representation store SHALL not be read or written
