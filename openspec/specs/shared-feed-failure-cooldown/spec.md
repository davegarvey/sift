# shared-feed-failure-cooldown Specification

## Purpose

This capability prevents repeated requests to unavailable feed servers across
users and Worker isolates while preserving successful feed caching and browser-local feed data.

## Requirements

### Requirement: Classify upstream failures without treating redirects as failures

The `/feed` proxy SHALL treat final upstream HTTP responses with status codes
from `400` through `599` as failures eligible for cooldown. A network or
timeout failure SHALL be represented as a `502` failure for cooldown purposes.
Responses in the `2xx` and `3xx` ranges SHALL NOT create failure cooldown state.

#### Scenario: Upstream returns HTTP 419

- **WHEN** an upstream feed request returns status `419`
- **THEN** the proxy SHALL return status `419` to the requesting client
- **AND** the proxy SHALL record a failure cooldown for that upstream URL

#### Scenario: Upstream returns a redirect

- **WHEN** an upstream request produces a `3xx` response that is surfaced by the proxy
- **THEN** the proxy SHALL not record a failure cooldown for that URL

#### Scenario: Upstream request times out

- **WHEN** the proxy cannot complete an upstream request because of a network error or timeout
- **THEN** the proxy SHALL treat the attempt as a `502` failure for cooldown purposes

### Requirement: Apply a bounded retry delay to upstream failures

For an eligible upstream failure, the proxy SHALL use a valid `Retry-After`
value when one is provided. Integer seconds and HTTP-date values SHALL be
accepted, the resulting delay SHALL be capped at 24 hours, and an absent or
unusable value SHALL use a 30-minute delay.

Requests for the same URL received while its cooldown is active SHALL NOT
contact the upstream server. They SHALL return the recorded failure status
with a `Retry-After` value describing the remaining delay.

#### Scenario: Failure provides a retry delay

- **WHEN** an upstream `4xx` or `5xx` response includes a valid `Retry-After`
- **THEN** the proxy SHALL suppress another request until that delay elapses
- **AND** the proxy SHALL cap the suppression period at 24 hours

#### Scenario: Failure has no usable retry delay

- **WHEN** an upstream `4xx` or `5xx` response has no usable `Retry-After`
- **THEN** the proxy SHALL suppress another upstream request for 30 minutes

#### Scenario: Request arrives during cooldown

- **WHEN** a request for a URL arrives before its recorded cooldown expires
- **THEN** the proxy SHALL return the recorded failure status
- **AND** the proxy SHALL not contact the upstream server
- **AND** the response SHALL include `Retry-After`

### Requirement: Share failure cooldown metadata across Worker users

When the Worker has a D1 binding, failure cooldown metadata SHALL be shared
across requests, users, and Worker isolates for the same complete validated
upstream URL. The shared record SHALL contain only a one-way URL hash, failure
status, retry timestamp, and maintenance timestamp. It SHALL NOT contain the
raw URL, feed body, parsed items, or user reading state.

#### Scenario: Another user requests a failed URL

- **WHEN** one Worker request records an upstream failure
- **AND** another request for the same validated URL arrives before the cooldown expires
- **THEN** the second request SHALL receive the recorded failure without contacting the upstream server

#### Scenario: D1 is unavailable

- **WHEN** the Worker has no usable D1 binding
- **THEN** the proxy SHALL retain its runtime-local failure suppression behavior
- **AND** feed fetching SHALL remain available without D1

### Requirement: Expire failure metadata without changing successful feed storage

Expired shared failure records SHALL no longer suppress upstream requests and
SHALL be removed by the existing scheduled cleanup. A later successful `200`
response or valid `304` revalidation SHALL clear any active local failure state.
The proxy SHALL continue storing successful feed representations and validators
in the existing feed cache rather than D1.

#### Scenario: Cooldown expires

- **WHEN** the recorded retry timestamp for a failed URL has passed
- **THEN** a later request MAY contact the upstream server again
- **AND** the expired record SHALL be eligible for scheduled cleanup

#### Scenario: Upstream recovers

- **WHEN** a revalidation succeeds with `200` or `304`
- **THEN** the proxy SHALL serve the successful representation normally
- **AND** the successful feed body SHALL not be written to the D1 failure-state table
