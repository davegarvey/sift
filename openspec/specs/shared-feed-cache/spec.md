# shared-feed-cache Specification

## Purpose

This capability reduces duplicate upstream feed requests through Sift's shared proxy while preserving browser-local parsing, storage, synchronization, and HTTP validator semantics.

## Requirements

### Requirement: Cache successful feed representations by complete URL

The `/feed` proxy SHALL cache successful feed representations using the complete upstream URL as the cache identity. Meaningful query parameters SHALL be preserved; the cache key SHALL NOT collapse distinct URLs into one representation.

The cache SHALL store the response body and its upstream `ETag` and `Last-Modified` validators. Cache entries SHALL expire 15 minutes after the most recent upstream `200` response or successful upstream `304` revalidation. Serving a cache hit SHALL NOT extend the expiry.

#### Scenario: Fresh cache hit avoids an upstream request

- **WHEN** a feed URL has a cached successful representation younger than 15 minutes
- **THEN** `/feed` SHALL return that representation without requesting the upstream URL
- **AND** the response SHALL preserve the cached `ETag` and `Last-Modified` values

#### Scenario: Distinct query URLs do not share representations

- **WHEN** two feed requests differ in any URL component that is sent upstream, including query parameters
- **THEN** each URL SHALL use an independent cache entry
- **AND** a response cached for one URL SHALL never be returned for the other URL

#### Scenario: Cache expiry is absolute from upstream activity

- **WHEN** a cached representation is served repeatedly before its expiry
- **THEN** each cache hit SHALL retain the original expiry time
- **AND** repeated hits SHALL not create a sliding cache window

### Requirement: Revalidate with shared validators and client-specific responses

When a cached representation is stale, the proxy SHALL revalidate upstream using the cached representation's validators rather than forwarding an individual client's validators upstream. The proxy SHALL evaluate the requesting client's `If-None-Match` and `If-Modified-Since` headers against the resulting cached representation when constructing the response.

The proxy SHALL honor normal GET conditional semantics: `If-None-Match` takes precedence over `If-Modified-Since`, and a matching validator SHALL produce `304 Not Modified` without a body.

#### Scenario: Client with an older ETag receives the cached update

- **WHEN** the cache contains representation ETag `"v2"` and a client sends `If-None-Match: "v1"`
- **THEN** the client SHALL receive `200 OK` with the cached body and ETag `"v2"`

#### Scenario: Client with the current ETag receives 304

- **WHEN** the cache contains representation ETag `"v2"` and a client sends `If-None-Match: "v2"`
- **THEN** the client SHALL receive `304 Not Modified`
- **AND** the response SHALL contain no feed body

#### Scenario: Stale cache revalidation uses the cache ETag

- **WHEN** a stale cached representation has ETag `"v1"` and a client sends a different ETag
- **THEN** the upstream revalidation request SHALL use `If-None-Match: "v1"`
- **AND** the client's different validator SHALL not be used as the upstream cache validator

### Requirement: Coalesce concurrent revalidation

The proxy SHALL coalesce concurrent stale or missing requests for the same complete feed URL into one upstream revalidation within the running server instance. All waiting requests SHALL independently receive `200` or `304` based on their own conditional headers.

#### Scenario: Concurrent stale requests share one upstream fetch

- **WHEN** multiple requests for the same stale feed URL arrive before revalidation completes
- **THEN** the proxy SHALL make no more than one upstream revalidation for that URL
- **AND** each waiting client SHALL receive the resulting representation or conditional response

### Requirement: Suppress repeated upstream requests after 429

When upstream returns `429`, the proxy SHALL preserve the existing cached successful representation if one exists and SHALL not replace it with the error response. The proxy SHALL suppress another upstream request for that URL until the upstream `Retry-After` delay has elapsed, bounded to a maximum of 24 hours.

If upstream provides no usable `Retry-After`, the proxy SHALL use a 30-minute suppression period. Requests received during suppression SHALL return `429` with a `Retry-After` value and SHALL not contact upstream.

#### Scenario: Rate-limited revalidation preserves the previous representation

- **WHEN** a stale feed revalidation receives `429`
- **THEN** the previous cached representation SHALL remain available for a later revalidation
- **AND** the `429` SHALL be returned to the requesting client

#### Scenario: Retry-After prevents repeated upstream requests

- **WHEN** a feed URL is under its recorded rate-limit suppression period
- **THEN** a request for that URL SHALL return `429`
- **AND** the proxy SHALL not request the upstream URL again before suppression expires

### Requirement: Expose non-authoritative cache diagnostics

Successful `/feed` responses SHALL expose the cached representation age through the standard `Age` response header. The proxy MAY expose an `X-Sift-Cache` diagnostic header describing whether the response was a cache hit, miss, or revalidation. These headers SHALL not be required for browser refresh correctness.

#### Scenario: Cache hit reports representation age

- **WHEN** `/feed` returns a cached successful representation
- **THEN** the response SHALL include `Age` in whole seconds since the last upstream fetch or revalidation
- **AND** the browser SHALL remain able to process the response without interpreting `Age`

### Requirement: Preserve feed proxy and sync boundaries

The shared cache SHALL apply only to `/feed` responses. It SHALL not cache `/article`, `/img`, or `/sync/*` responses, and it SHALL not store feed XML, parsed items, or read/starred state in the sync service.

#### Scenario: Sync behavior remains browser-local for feed content

- **WHEN** one synchronized device refreshes a feed through `/feed`
- **THEN** the shared cache MAY make the resulting representation available to another device's later `/feed` request
- **AND** the sync service SHALL not receive or return the feed XML or parsed item records

#### Scenario: Other proxy endpoints remain uncached

- **WHEN** a request targets `/article` or `/img`
- **THEN** the request SHALL retain its existing passthrough behavior
- **AND** it SHALL not populate or read the shared feed cache
