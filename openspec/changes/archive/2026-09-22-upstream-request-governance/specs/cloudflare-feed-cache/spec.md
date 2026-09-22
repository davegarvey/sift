## ADDED Requirements

### Requirement: Reserve origin request slots through D1

When D1 is available, the Worker SHALL use an atomic D1 reservation to enforce the configured minimum spacing between upstream request starts for the same normalized origin across Worker isolates and data-center locations. The reservation state SHALL be keyed by a one-way origin hash and SHALL not contain raw URLs, response bodies, or user data. Successful response bodies SHALL remain in the existing regional cache layers.

#### Scenario: Requests from different Worker locations share origin spacing

- **WHEN** concurrent Worker requests from different isolates or data-center locations target the same origin
- **THEN** each request that proceeds upstream SHALL hold an atomic slot from the shared D1 policy
- **AND** request starts SHALL observe the configured origin spacing

#### Scenario: D1 reservation is unavailable

- **WHEN** D1 cannot reserve a request slot
- **THEN** the Worker SHALL apply its runtime-local origin governor
- **AND** it SHALL not bypass any origin cooldown already known to that runtime

#### Scenario: D1 does not store response bodies

- **WHEN** the Worker reserves a request slot or records an origin cooldown
- **THEN** D1 SHALL store only hashed origin and request-policy metadata
- **AND** successful feed, article, and image bodies SHALL remain outside D1
