## MODIFIED Requirements

### Requirement: Cache successful feed representations by complete URL

The `/feed` proxy SHALL cache successful feed representations using the complete upstream URL as the cache identity. Meaningful query parameters SHALL be preserved; the cache key SHALL NOT collapse distinct URLs into one representation.

The cache SHALL store the response body and its upstream `ETag` and `Last-Modified` validators. An upstream `Set-Cookie` or `Vary: *` header SHALL NOT prevent caching, because the proxy sends no client credentials and never returns upstream cookies. Representations larger than 2 MB SHALL NOT be cached.

A representation SHALL be fresh from the most recent upstream `200` response or successful upstream `304` revalidation for its freshness lifetime, as defined by the upstream freshness hints requirement. Serving a cache hit SHALL NOT extend freshness. The cache SHALL retain a representation for 24 hours after it stops being fresh so that it can be served during transient upstream failures.

#### Scenario: Fresh cache hit avoids an upstream request

- **WHEN** a feed URL has a fresh cached successful representation
- **THEN** `/feed` SHALL return that representation without requesting the upstream URL
- **AND** the response SHALL preserve the cached `ETag` and `Last-Modified` values

#### Scenario: Cookie-setting feed is cached

- **WHEN** an upstream returns a successful feed response that includes `Set-Cookie`
- **THEN** the proxy SHALL cache the representation
- **AND** a later request within its freshness lifetime SHALL not contact the upstream
- **AND** the upstream cookie SHALL not be returned to the client

#### Scenario: Distinct query URLs do not share representations

- **WHEN** two feed requests differ in any URL component that is sent upstream, including query parameters
- **THEN** each URL SHALL use an independent cache entry
- **AND** a response cached for one URL SHALL never be returned for the other URL

#### Scenario: Cache expiry is absolute from upstream activity

- **WHEN** a cached representation is served repeatedly before its freshness ends
- **THEN** each cache hit SHALL retain the original freshness time
- **AND** repeated hits SHALL not create a sliding cache window

### Requirement: Suppress repeated upstream requests after 429

When upstream returns an HTTP `4xx` or `5xx` failure, the proxy SHALL preserve
the existing cached successful representation if one exists and SHALL not
replace it with the error response. The proxy SHALL suppress another upstream
request for that URL until the applicable retry delay has elapsed, bounded to a
maximum of 24 hours.

If upstream provides a usable `Retry-After`, the proxy SHALL honor it. If it
provides no usable value, the proxy SHALL use a 30-minute suppression period.
Requests received during suppression SHALL not contact upstream. They SHALL
receive the retained representation when the failure is transient and one is
available, and otherwise the recorded failure status with a `Retry-After` value.

#### Scenario: Rate-limited revalidation preserves the previous representation

- **WHEN** a stale feed revalidation receives `429` and a retained representation exists
- **THEN** the requesting client SHALL receive the retained representation marked as stale
- **AND** the previous cached representation SHALL remain available for a later revalidation

#### Scenario: Generic failure preserves the previous representation

- **WHEN** a stale feed revalidation receives a non-transient `4xx` status such as `404`
- **THEN** the previous cached representation SHALL remain available for a later revalidation
- **AND** the failure status SHALL be returned to the requesting client

#### Scenario: Retry-After prevents repeated upstream requests

- **WHEN** a feed URL is under its recorded failure suppression period
- **THEN** the proxy SHALL not request the upstream URL again before suppression expires
- **AND** the request SHALL receive the retained representation if the failure is transient and one exists, or otherwise the recorded failure status

### Requirement: Expose non-authoritative cache diagnostics

Successful `/feed` responses SHALL expose the cached representation age through the standard `Age` response header, measured from the last upstream `200` or successful `304`. The proxy MAY expose an `X-Sift-Cache` diagnostic header describing whether the response was a cache hit, miss, revalidation or stale representation. A stale representation SHALL include `X-Sift-Retry-After` with the whole seconds until the proxy will next contact the upstream. These headers SHALL not be required for browser refresh correctness.

#### Scenario: Cache hit reports representation age

- **WHEN** `/feed` returns a cached successful representation
- **THEN** the response SHALL include `Age` in whole seconds since the last upstream fetch or revalidation
- **AND** the browser SHALL remain able to process the response without interpreting `Age`

#### Scenario: Stale representation reports the next upstream attempt

- **WHEN** `/feed` returns a retained representation because the upstream is in cooldown
- **THEN** the response SHALL include `X-Sift-Cache: stale`
- **AND** it SHALL include `X-Sift-Retry-After` with the remaining cooldown in seconds

## ADDED Requirements

### Requirement: Derive freshness from upstream hints

The freshness lifetime of a representation SHALL be the longest of 15 minutes and any upstream freshness hint, capped at 24 hours. Header hints SHALL be `Cache-Control` `s-maxage`, otherwise `max-age`, otherwise `Expires` relative to `Date`. Feed hints SHALL be the RSS `<ttl>` element in minutes and the syndication module's `sy:updatePeriod` divided by `sy:updateFrequency`. A `304` revalidation SHALL recompute freshness from its own headers and the stored body.

#### Scenario: Upstream asks for a longer lifetime

- **WHEN** an upstream feed response has `Cache-Control: max-age=3600`
- **THEN** the proxy SHALL not contact the upstream for that URL for one hour

#### Scenario: Feed declares a ttl

- **WHEN** a feed body contains `<ttl>120</ttl>` and headers give no longer hint
- **THEN** the representation SHALL be fresh for two hours

#### Scenario: Short or excessive hints are bounded

- **WHEN** an upstream hint is shorter than 15 minutes or longer than 24 hours
- **THEN** the freshness lifetime SHALL be 15 minutes or 24 hours respectively

### Requirement: Serve retained representations during transient upstream failures

When a representation is no longer fresh but still retained, and the upstream request fails or is blocked by a URL or origin cooldown with a transient status (`408`, `419`, `425`, `429`, any `5xx`, or a network failure represented as `502`), the proxy SHALL return the retained representation instead of the failure. It SHALL apply the client's conditional headers to it as for a cache hit. Non-transient failures SHALL be returned to the client. Serving a retained representation SHALL not alter cooldown recording or cause an upstream request.

#### Scenario: Another client refreshes during a rate limit

- **WHEN** one request's revalidation receives `429`
- **AND** another client requests the same feed during the resulting cooldown
- **THEN** the second client SHALL receive the retained representation
- **AND** the upstream SHALL not be contacted

#### Scenario: Retention has ended

- **WHEN** a representation has been stale for more than 24 hours and the upstream returns `429`
- **THEN** the proxy SHALL return the `429` to the client

#### Scenario: Feed has gone

- **WHEN** a stale revalidation receives `410`
- **THEN** the proxy SHALL return `410` to the client even though a retained representation exists
