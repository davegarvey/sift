## MODIFIED Requirements

### Requirement: Apply a bounded retry delay to upstream failures

For an eligible upstream failure, the proxy SHALL use a valid `Retry-After`
value when one is provided. Integer seconds and HTTP-date values SHALL be
accepted, the resulting delay SHALL be capped at 24 hours, and an absent or
unusable value SHALL use a 30-minute delay.

Requests for the same URL received while its cooldown is active SHALL NOT
contact the upstream server. When the cooldown status is transient and a
retained successful representation exists, they SHALL receive that
representation. Otherwise they SHALL return the recorded failure status with a
`Retry-After` value describing the remaining delay.

#### Scenario: Failure provides a retry delay

- **WHEN** an upstream `4xx` or `5xx` response includes a valid `Retry-After`
- **THEN** the proxy SHALL suppress another request until that delay elapses
- **AND** the proxy SHALL cap the suppression period at 24 hours

#### Scenario: Failure has no usable retry delay

- **WHEN** an upstream `4xx` or `5xx` response has no usable `Retry-After`
- **THEN** the proxy SHALL suppress another upstream request for 30 minutes

#### Scenario: Request arrives during cooldown

- **WHEN** a request for a URL arrives before its recorded cooldown expires
- **AND** no retained successful representation exists
- **THEN** the proxy SHALL return the recorded failure status
- **AND** the proxy SHALL not contact the upstream server
- **AND** the response SHALL include `Retry-After`

#### Scenario: Request arrives during a transient cooldown with a retained representation

- **WHEN** a request for a URL arrives before its recorded `429` cooldown expires
- **AND** a retained successful representation exists
- **THEN** the proxy SHALL return the retained representation
- **AND** the proxy SHALL not contact the upstream server
