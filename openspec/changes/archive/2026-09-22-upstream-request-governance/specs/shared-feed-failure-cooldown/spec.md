## ADDED Requirements

### Requirement: Apply an origin-wide cooldown to throttling and challenge responses

When any Sift upstream fetch path receives `429` or `419`, the proxy SHALL record a cooldown keyed by the normalized origin as well as preserving the existing URL-level failure state. Requests to any path or query on that origin SHALL not contact the upstream during the origin cooldown. A valid `Retry-After` SHALL be honored without being shortened. A `419` without a valid value SHALL use progressive backoff beginning at no less than six hours and increasing after repeated challenge responses, capped at 24 hours.

When the upstream omits `Retry-After`, the proxy SHALL return a `Retry-After` value for its generated origin cooldown on the initial failure response and during later cooldown responses.

#### Scenario: Different URL arrives during a 429 cooldown

- **WHEN** one path on an origin returns `429`
- **AND** a request for another path or query on that origin arrives before the retry time
- **THEN** the second request SHALL return a cooldown response without contacting the upstream

#### Scenario: Article path arrives during a 419 cooldown

- **WHEN** a feed request from an origin returns `419`
- **AND** an article or image request for that origin arrives before the retry time
- **THEN** the proxy SHALL return a cooldown response without contacting the upstream

#### Scenario: Initial 419 omits Retry-After

- **WHEN** an upstream returns `419` without a valid `Retry-After`
- **THEN** the proxy SHALL apply its progressive origin cooldown
- **AND** the proxy response SHALL include a `Retry-After` describing the generated cooldown

#### Scenario: Retry-After exceeds the existing URL retry cap

- **WHEN** an upstream `429` or `419` provides a valid `Retry-After` longer than 24 hours
- **THEN** the origin cooldown SHALL remain active for at least the upstream-specified delay
- **AND** Sift SHALL not shorten that delay to its URL-level retry cap

### Requirement: Share hashed origin cooldowns through D1

When a Worker has a D1 binding, origin cooldown status and retry timing SHALL be shared across Worker requests, isolates, and data-center locations. D1 state SHALL use a one-way hash of the normalized origin and SHALL not store the raw origin, path, query, feed body, or user data.

#### Scenario: Another Worker location receives a cooled-down origin

- **WHEN** one Worker request records an origin cooldown
- **AND** a request at another isolate or data-center location targets the same origin before retry time
- **THEN** that request SHALL honor the shared cooldown without contacting the upstream

#### Scenario: D1 is unavailable

- **WHEN** D1 cannot read or reserve shared origin state
- **THEN** the request SHALL use the runtime-local origin governor and cooldown state
- **AND** it SHALL not bypass a cooldown already known to that runtime
