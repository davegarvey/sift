## Purpose

This capability limits unnecessary upstream traffic across Sift's refresh scheduler and proxy fetch paths, and makes rate-limit and challenge responses diagnosable without persisting feed URLs or content.

## ADDED Requirements

### Requirement: Learn refresh cadence from newly observed items

The browser refresh scheduler SHALL calculate a feed's learned cadence using only items first observed since the preceding successful observation and the elapsed time between those observations. It SHALL NOT shorten a feed's interval based only on the size of the current feed snapshot or the age of its newest item. Automatic cadence changes SHALL respect the configured minimum interval.

#### Scenario: Large unchanged snapshot does not accelerate polling

- **WHEN** a feed returns many items that are already stored
- **THEN** the scheduler SHALL treat the refresh as having observed no new items
- **AND** the learned interval SHALL NOT be shortened because of the snapshot size

#### Scenario: New entries are measured across observations

- **WHEN** a successful refresh discovers new item IDs
- **THEN** cadence learning SHALL use those newly discovered IDs and the elapsed time since the prior successful observation
- **AND** the next automatic refresh SHALL not occur before the configured minimum interval

### Requirement: Stagger automatic refreshes

The scheduler SHALL distribute automatic feed refreshes over time using a stable per-feed jitter. Jitter SHALL NOT cause a feed to be refreshed before its learned interval has elapsed. Startup recovery SHALL not begin every due feed at the same instant.

#### Scenario: Several feeds become due together

- **WHEN** multiple feeds reach their learned refresh time together
- **THEN** their automatic requests SHALL be spread across the configured jitter window
- **AND** each feed SHALL remain no earlier than its learned interval

### Requirement: Govern every Sift upstream request by origin

Every upstream HTTP request initiated by Sift through feed, article, image, discovery, and MCP functionality SHALL use the same origin-scoped request policy. The policy key SHALL consist of the normalized scheme, hostname, and effective port, independent of path and query. Every redirect destination SHALL pass through the policy for its destination origin.

The policy SHALL enforce a configured minimum spacing between request starts across the Worker deployment and a bounded in-flight request limit within each runtime. Concurrent requests for the same complete URL SHALL be coalesced where their request semantics match. If a request cannot obtain a slot within the configured queue bound, Sift SHALL return a local `429` response with `Retry-After` and SHALL not contact the upstream origin.

#### Scenario: Different feed paths share one origin budget

- **WHEN** requests target different paths or query strings on the same origin
- **THEN** all requests SHALL consume the same origin request budget
- **AND** the budget SHALL not be reset by changing the feed URL path or query

#### Scenario: Redirect reaches another origin

- **WHEN** an upstream response redirects to a different origin
- **THEN** the redirect destination request SHALL acquire a slot from that destination origin's policy

#### Scenario: Origin queue is full

- **WHEN** an upstream request cannot obtain an origin slot within the configured queue bound
- **THEN** Sift SHALL return a local `429` response with `Retry-After` and request-source diagnostics
- **AND** Sift SHALL not send that request upstream

### Requirement: Honor origin retry delays across statuses

Sift SHALL parse and preserve valid `Retry-After` values on upstream and locally generated cooldown responses for every status subject to cooldown. The browser SHALL persist the returned retry time for feed failures and SHALL not let manual refresh bypass an active server cooldown. A valid upstream delay SHALL not be shortened by a Sift retry cap.

When Sift establishes a cooldown because an upstream response omitted `Retry-After`, the proxy SHALL return a `Retry-After` value for the effective Sift cooldown on the initial failure and subsequent cooldown responses.

Upstream `429` and `419` responses SHALL activate an origin-wide cooldown across all Sift upstream fetch paths. A `419` without a valid `Retry-After` SHALL use progressive backoff beginning at no less than six hours and increasing after repeated challenge responses, capped at 24 hours. A `429` without a valid `Retry-After` SHALL use the configured origin fallback delay. Jitter MAY extend a valid delay but SHALL not cause an earlier retry.

#### Scenario: 419 includes Retry-After

- **WHEN** an upstream request returns `419` with a valid `Retry-After`
- **THEN** Sift SHALL suppress requests to that origin across feed, article, image, discovery, and MCP paths until at least that time
- **AND** manual refresh SHALL not contact the origin during the cooldown

#### Scenario: Repeated 419 has no Retry-After

- **WHEN** the same origin returns another `419` after its prior cooldown expires and provides no valid `Retry-After`
- **THEN** the next origin cooldown SHALL increase according to the configured progressive backoff
- **AND** the cooldown SHALL not exceed 24 hours

#### Scenario: Initial 419 has no Retry-After

- **WHEN** an upstream returns `419` without a valid `Retry-After`
- **THEN** Sift SHALL establish the configured progressive cooldown
- **AND** the initial proxy response SHALL include a `Retry-After` for that cooldown

#### Scenario: 429 delay is honored by the client

- **WHEN** an upstream or Sift-generated cooldown response returns `429` with `Retry-After`
- **THEN** the browser SHALL persist that retry time
- **AND** background and manual feed refreshes SHALL not retry before it

### Requirement: Do not cache upstream failures

Proxy responses for upstream or Sift-generated failures SHALL include `Cache-Control: no-store`. Successful response caching SHALL remain separate from failure cooldown storage. The `/img` route SHALL apply long-lived immutable cache headers only to successful responses.

#### Scenario: Image origin returns a rate limit

- **WHEN** an image upstream returns a non-success response such as `429` or `419`
- **THEN** the Sift image response SHALL not be stored as a long-lived immutable response
- **AND** the response SHALL include `Cache-Control: no-store`

#### Scenario: Feed cooldown is active

- **WHEN** Sift returns a cached cooldown response for a feed URL
- **THEN** browser or intermediary caching SHALL not outlive or bypass the server cooldown state

### Requirement: Expose privacy-safe upstream diagnostics

Proxy error responses SHALL distinguish an upstream response from a URL cooldown, an origin cooldown, and a local request-governor response. They SHALL expose the upstream status when one exists, the retry delay when applicable, and the route-level cache or policy outcome. Persistent diagnostics SHALL contain only a one-way origin or URL hash, endpoint category, status, timing metadata, and an allowlist of non-sensitive upstream response metadata needed to distinguish origin responses from intermediary or local cooldown responses; they SHALL NOT contain raw URLs, query strings, article identifiers, arbitrary response headers, or response bodies.

#### Scenario: Upstream returns a 419

- **WHEN** the first upstream response for a request is `419`
- **THEN** the proxy response SHALL identify the upstream status and the initial upstream outcome
- **AND** persistent diagnostics SHALL not contain the raw URL or response body

#### Scenario: Later request is blocked by cooldown

- **WHEN** a request is rejected because an origin cooldown is active
- **THEN** the response SHALL identify the origin-cooldown outcome and include the remaining `Retry-After`
- **AND** the diagnostic SHALL distinguish the Sift response from a new upstream response
