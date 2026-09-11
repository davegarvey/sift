## MODIFIED Requirements

### Requirement: Preserve runtime-local coordination boundaries

Successful feed representations SHALL remain data-center-local when stored in
the Worker Cache API, and in-flight successful revalidation MAY remain
runtime-local. When D1 is available, failure status and retry timing SHALL be
shared across Worker requests and isolates using hashed complete upstream URLs.
The shared failure state SHALL not store feed bodies or become part of sync
data. A cache miss in another Cloudflare data center MAY perform its own
successful upstream request.

#### Scenario: Cache locations miss independently

- **WHEN** the same successful feed representation is absent from two Cloudflare cache locations
- **THEN** each location MAY perform one local successful revalidation
- **AND** the proxy SHALL continue to return correct feed representations without treating the successful-body caches as globally consistent

#### Scenario: Failure cooldown is shared through D1

- **WHEN** one Worker request records a `4xx` or `5xx` upstream failure for a URL
- **AND** another isolate receives the same URL before the retry timestamp
- **THEN** the second isolate SHALL honor the shared cooldown
- **AND** it SHALL not request the upstream URL

#### Scenario: Rate-limit state remains local

- **WHEN** the Worker has no usable D1 binding
- **THEN** failure suppression SHALL remain runtime-local
- **AND** the feed proxy SHALL retain its existing memory and Worker Cache API fallbacks
