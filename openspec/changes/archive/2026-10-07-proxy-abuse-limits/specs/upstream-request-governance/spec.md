## ADDED Requirements

### Requirement: Apply client limits before origin governance

The same-site check and the per-client limit for `/feed`, `/article` and `/img` SHALL run before the proxy validates the target, consults a cache, or asks the origin governor for a slot. A request rejected by either SHALL NOT consume an origin in-flight slot, reserve an origin request slot, create or advance origin cooldown state, or write to D1.

#### Scenario: Limited client does not consume origin slots

- **WHEN** a client over its per-client budget requests a proxy URL
- **THEN** the origin governor SHALL not be invoked for that request
- **AND** the origin's spacing, in-flight count and cooldown state SHALL be unchanged

#### Scenario: Cross-site request does not reach the governor

- **WHEN** a request is rejected by the same-site check
- **THEN** the origin governor SHALL not be invoked for that request

#### Scenario: Local rejections are distinguishable

- **WHEN** a proxy request is rejected by the same-site check or the per-client limit
- **THEN** `X-Sift-Request-Source` SHALL be `same-site-check` or `client-limit`, distinct from `local-gate`, `origin-cooldown` and `url-cooldown`
