## Purpose

Protect Sift's server-side upstream proxy from local and private network
requests while preserving normal public feed, article, image, and redirect use.

## ADDED Requirements

### Requirement: Validate every upstream target before requesting it

The server SHALL apply one safety policy to every user- or content-supplied
upstream URL used by feed, article, image, or agent operations. The policy SHALL
accept only absolute `http:` and `https:` URLs and SHALL reject targets whose
host is loopback, unspecified, link-local, metadata, private, multicast, or
otherwise non-public according to the existing target policy. A hostname with
no usable terminal A or AAAA address, or with any malformed or non-public
terminal address, SHALL be rejected. A rejected target SHALL NOT be requested.

#### Scenario: Local literal target is rejected

- **WHEN** a proxy request supplies a loopback, private, link-local, or metadata IP literal
- **THEN** the server SHALL reject the request
- **AND** the target SHALL not receive an upstream request

#### Scenario: Unsupported URL scheme is rejected

- **WHEN** a proxy or agent operation supplies a non-HTTP(S) URL
- **THEN** the server SHALL reject the operation
- **AND** the target SHALL not receive an upstream request

#### Scenario: Hostname resolving to a non-public address is rejected

- **WHEN** a supplied hostname resolves to one or more terminal addresses
- **AND** any terminal address is non-public
- **THEN** the server SHALL reject the operation
- **AND** the target SHALL not receive an upstream request

#### Scenario: Hostname with no usable address is rejected

- **WHEN** a supplied hostname has no usable terminal A or AAAA address
- **THEN** the server SHALL reject the operation
- **AND** the target SHALL not receive an upstream request

#### Scenario: Public HTTP(S) target remains available

- **WHEN** a supplied absolute HTTP(S) URL passes the target safety policy
- **THEN** the server SHALL be allowed to request that target

### Requirement: Follow public redirects only after revalidation

The server SHALL preserve ordinary redirects for public upstream resources. For
each `301`, `302`, `303`, `307`, or `308` response with a `Location` header, the
server SHALL resolve the location against the current URL and reapply the full
upstream target safety policy before making the next request. The server SHALL
follow no more than five redirects for one operation and SHALL retain the
existing upstream timeout budget for the complete redirect sequence. A missing,
malformed, unsafe, or excessive redirect SHALL fail the operation without
requesting its destination.

#### Scenario: Public HTTP-to-HTTPS redirect succeeds

- **WHEN** a public upstream responds with a redirect to another public HTTPS URL
- **THEN** the server SHALL request the validated destination
- **AND** the proxy or agent operation SHALL receive the destination response

#### Scenario: Relative public redirect succeeds

- **WHEN** a public upstream responds with a relative `Location` pointing to a public URL on the same host
- **THEN** the server SHALL resolve and validate that URL
- **AND** the server SHALL request it when it passes the safety policy

#### Scenario: Redirect to a private target is blocked

- **WHEN** a public upstream responds with a `Location` pointing to a local or private target
- **THEN** the server SHALL fail the operation with the existing generic upstream failure
- **AND** the private target SHALL not receive an upstream request

#### Scenario: Redirect loop is bounded

- **WHEN** an upstream redirects repeatedly without producing a final response
- **THEN** the server SHALL stop after five redirects
- **AND** the operation SHALL fail with the existing generic upstream failure

### Requirement: Do not expose upstream redirects to clients

The proxy SHALL return either the final upstream response or the existing
generic upstream failure response. It SHALL NOT pass an upstream `Location`,
`Refresh`, or equivalent redirect instruction to the browser when the redirect
was rejected, malformed, or exceeded the redirect limit.

#### Scenario: Rejected redirect does not redirect the browser

- **WHEN** an upstream redirect fails target validation
- **THEN** the proxy SHALL return a generic upstream failure
- **AND** the response SHALL not contain a redirect instruction

#### Scenario: Redirecting public response is consumed by the proxy

- **WHEN** an upstream public redirect is followed successfully
- **THEN** the browser SHALL receive the final response rather than the intermediate redirect

### Requirement: Agent and discovered URLs use the same safety policy

Agent operations SHALL apply the upstream target and redirect policy to direct
tool arguments and to URLs discovered from fetched feed or HTML content. A
malicious discovered URL SHALL be skipped or fail the operation without being
requested.

#### Scenario: Agent direct private URL is rejected

- **WHEN** an agent requests discovery or feed items for a local or private URL
- **THEN** the operation SHALL fail without requesting that URL

#### Scenario: Malicious alternate-feed link is rejected

- **WHEN** fetched HTML contains an alternate-feed link to a local or private URL
- **THEN** the server SHALL not request that link
- **AND** discovery MAY continue with other candidates
