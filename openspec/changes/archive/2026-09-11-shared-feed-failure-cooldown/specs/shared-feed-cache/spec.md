## MODIFIED Requirements

### Requirement: Suppress repeated upstream requests after 429

When upstream returns an HTTP `4xx` or `5xx` failure, the proxy SHALL preserve
the existing cached successful representation if one exists and SHALL not
replace it with the error response. The proxy SHALL suppress another upstream
request for that URL until the applicable retry delay has elapsed, bounded to a
maximum of 24 hours.

If upstream provides a usable `Retry-After`, the proxy SHALL honor it. If it
provides no usable value, the proxy SHALL use a 30-minute suppression period.
Requests received during suppression SHALL return the recorded failure status
with a `Retry-After` value and SHALL not contact upstream.

#### Scenario: Rate-limited revalidation preserves the previous representation

- **WHEN** a stale feed revalidation receives `429`
- **THEN** the previous cached representation SHALL remain available for a later revalidation
- **AND** the `429` SHALL be returned to the requesting client

#### Scenario: Generic failure preserves the previous representation

- **WHEN** a stale feed revalidation receives a `4xx` or `5xx` status other than `304`
- **THEN** the previous cached representation SHALL remain available for a later revalidation
- **AND** the failure status SHALL be returned to the requesting client

#### Scenario: Retry-After prevents repeated upstream requests

- **WHEN** a feed URL is under its recorded failure suppression period
- **THEN** a request for that URL SHALL return the recorded failure status
- **AND** the proxy SHALL not request the upstream URL again before suppression expires
