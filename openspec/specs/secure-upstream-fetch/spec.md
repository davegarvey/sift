# secure-upstream-fetch Specification

## Purpose

Protect Sift's server-side upstream proxy from local and private network
requests while preserving normal public feed, article, image, and redirect use.

## Requirements

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

### Requirement: Accept proxy requests only from Sift's own origin

The `/feed`, `/article` and `/img` endpoints SHALL reject a request whose `Sec-Fetch-Site` header is present and is neither `same-origin` nor `none`, with status `403`, before validating the target or contacting any upstream. A request without the header SHALL NOT be rejected on this basis. The rejection SHALL carry the endpoint's isolation headers, `Cache-Control: no-store` and `X-Sift-Request-Source: same-site-check`.

#### Scenario: Cross-site request is rejected

- **WHEN** a request to a proxy endpoint carries `Sec-Fetch-Site: cross-site`
- **THEN** the proxy SHALL return `403` with the endpoint's isolation headers
- **AND** no upstream request SHALL be made

#### Scenario: Same-site request from another origin is rejected

- **WHEN** a request to a proxy endpoint carries `Sec-Fetch-Site: same-site`
- **THEN** the proxy SHALL return `403`

#### Scenario: Application and address-bar requests are accepted

- **WHEN** a request to a proxy endpoint carries `Sec-Fetch-Site: same-origin` or `none`
- **THEN** the request SHALL proceed to the per-client limit and the normal proxy flow

#### Scenario: Non-browser client has no Sec-Fetch-Site header

- **WHEN** a request to a proxy endpoint carries no `Sec-Fetch-Site` header
- **THEN** the request SHALL NOT be rejected by the same-site check
- **AND** it SHALL remain subject to the per-client limit

### Requirement: Limit proxy requests per client

The `/feed`, `/article` and `/img` endpoints SHALL limit requests per client IP address in fixed 60-second windows. `/feed` and `/article` SHALL share one budget of 2000 requests per window, and `/img` SHALL have a separate budget of 600 requests per window. A request over its budget SHALL receive `429` with `Retry-After`, `Cache-Control: no-store`, `X-Sift-Request-Source: client-limit` and the endpoint's isolation headers. Responses served from the shared feed cache SHALL count towards the budget. The limit SHALL be applied after the same-site check and before target validation, origin governance, cache lookup or any upstream request.

On Cloudflare Workers the limit SHALL be enforced by Cloudflare's Workers rate limiting binding when it is configured, keyed by the `CF-Connecting-IP` address, without writing to D1. On Node and Bun, and on Workers without the binding, the limit SHALL be enforced by a bounded process-local limiter with the same budgets. If the binding call fails, the process-local limiter SHALL decide instead and the request SHALL NOT fail because of it.

On Node and Bun the client address SHALL be the connection's socket address. `X-Forwarded-For` SHALL be ignored unless an explicit trusted-proxy setting enables it, in which case only the entry added by the configured number of trusted proxies SHALL be used. IPv6 addresses SHALL be keyed by their /64 prefix.

#### Scenario: Client exceeds its budget

- **WHEN** one client address makes more requests to `/feed` and `/article` than its budget within a window
- **THEN** the excess requests SHALL receive `429` with `Retry-After` and the endpoint's isolation headers
- **AND** no target validation or upstream request SHALL be made for them

#### Scenario: Budget recovers

- **WHEN** a limited client waits for the `Retry-After` interval
- **THEN** its next request SHALL be accepted

#### Scenario: Image and feed budgets are separate

- **WHEN** a client has exhausted its `/img` budget
- **THEN** its `/feed` and `/article` requests SHALL still be accepted

#### Scenario: Clients are limited independently

- **WHEN** one client address is limited
- **THEN** requests from other client addresses SHALL be unaffected

#### Scenario: Binding is absent

- **WHEN** the rate limiting binding is not configured, as in local development and tests
- **THEN** the process-local limiter SHALL enforce the same budgets
- **AND** the proxy SHALL otherwise behave normally

#### Scenario: Forwarded address is not trusted by default

- **WHEN** a request to a Node or Bun server carries `X-Forwarded-For` and no trusted-proxy setting is enabled
- **THEN** the limit SHALL be keyed by the socket address

#### Scenario: Limit rejection is privacy-safe

- **WHEN** a request is rejected by the same-site check or the per-client limit
- **THEN** the server MAY record a diagnostic containing only the route, status, reason and source
- **AND** the diagnostic SHALL NOT contain the client address or the requested URL

### Requirement: Cap proxy response bodies

`/feed` SHALL return at most 2 MiB, `/article` at most 5 MiB and `/img` at most 10 MiB of upstream body. When the upstream declares a `Content-Length` over the cap, the proxy SHALL cancel the upstream body without reading it and return `502` with `Cache-Control: no-store`. When a body without a declared length, or with a misleading one, exceeds the cap while streaming, the proxy SHALL stop reading the upstream body at the cap without buffering the whole body. A streamed oversize feed SHALL return `502`; a streamed oversize article or image SHALL error the response stream. The feed cache SHALL NOT buffer or retain more than 2 MiB for one response.

#### Scenario: Declared oversize feed is rejected

- **WHEN** an upstream feed response declares a `Content-Length` over 2 MiB
- **THEN** the proxy SHALL cancel the upstream body without reading it
- **AND** return `502` with `Cache-Control: no-store` and the endpoint's isolation headers

#### Scenario: Declared oversize article is rejected

- **WHEN** an upstream article response declares a `Content-Length` over 5 MiB
- **THEN** the proxy SHALL return `502` with `Cache-Control: no-store` and the endpoint's isolation headers
- **AND** the response SHALL NOT contain the upstream body

#### Scenario: Declared oversize image is rejected

- **WHEN** an upstream image response declares a `Content-Length` over 10 MiB
- **THEN** the proxy SHALL return `502` with `Cache-Control: no-store` and the endpoint's isolation headers

#### Scenario: Streamed oversize feed is rejected without full buffering

- **WHEN** an upstream feed body without a trustworthy `Content-Length` exceeds 2 MiB
- **THEN** the proxy SHALL stop reading it as soon as the cap is exceeded
- **AND** return `502` without retaining or forwarding the body

#### Scenario: Streamed oversize article or image is aborted

- **WHEN** an upstream article or image body without a trustworthy `Content-Length` exceeds its cap while streaming
- **THEN** the proxy SHALL error the response stream at the cap
- **AND** it SHALL stop reading the upstream body

#### Scenario: Body at the cap is delivered

- **WHEN** an upstream body is exactly the cap size
- **THEN** the proxy SHALL deliver it in full

### Requirement: Isolate proxied responses from the application origin

Every response from the `/feed`, `/article` and `/img` proxy endpoints, including `304`, upstream error and locally generated error responses, SHALL include `X-Content-Type-Options: nosniff` and a `Content-Security-Policy` containing the `sandbox` directive without `allow-scripts` or `allow-same-origin`. `/feed` and `/article` responses SHALL also include `default-src 'none'`. A proxied response opened directly in a browser SHALL NOT run script or gain access to Sift's origin storage.

#### Scenario: Proxied article opened directly is sandboxed

- **WHEN** a browser navigates to `/article?url=` for a page containing script
- **THEN** the response SHALL carry `Content-Security-Policy: default-src 'none'; sandbox`
- **AND** the document SHALL have an opaque origin with no access to Sift's IndexedDB or localStorage

#### Scenario: Proxied feed is sandboxed

- **WHEN** `/feed?url=` returns a successful or not-modified response
- **THEN** the response SHALL carry `Content-Security-Policy: default-src 'none'; sandbox` and `X-Content-Type-Options: nosniff`

#### Scenario: Proxied image is sandboxed

- **WHEN** `/img?url=` returns an image
- **THEN** the response SHALL carry `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`
- **AND** the image SHALL still render in an `<img>` element in the application

#### Scenario: Local failure is sandboxed

- **WHEN** a proxy request is rejected before any upstream request, such as for an invalid `url` parameter
- **THEN** the error response SHALL carry the endpoint's isolation headers

### Requirement: Do not forward upstream headers on proxy errors

When an upstream returns a non-2xx status other than `304`, the proxy SHALL return that status with `Content-Type: text/plain; charset=utf-8` and `Cache-Control: no-store`. It SHALL forward only `Retry-After`, `X-Sift-Retry-After`, `X-Sift-Request-Source` and `X-Sift-Cache`, and SHALL NOT forward any other upstream header, including `Content-Type` and `Set-Cookie`.

#### Scenario: Upstream HTML error is returned as plain text

- **WHEN** an upstream returns `404` with `Content-Type: text/html` and a `Set-Cookie` header
- **THEN** the proxy response SHALL have status `404` and `Content-Type: text/plain; charset=utf-8`
- **AND** the response SHALL NOT contain `Set-Cookie`

#### Scenario: Retry guidance is preserved

- **WHEN** an upstream error carries `Retry-After`
- **THEN** the proxy response SHALL include the same `Retry-After` value

### Requirement: Image proxy serves only images

`/img` SHALL return a successful upstream body only when the upstream response declares a `Content-Type` beginning with `image/`. Otherwise it SHALL return `502` with `Cache-Control: no-store` and SHALL NOT return the upstream body.

#### Scenario: Non-image upstream is refused

- **WHEN** `/img?url=` targets a resource served as `text/html`, `application/octet-stream`, or with no content type
- **THEN** the proxy SHALL return `502` with `Cache-Control: no-store`
- **AND** the response SHALL NOT contain the upstream body

#### Scenario: SVG image is allowed

- **WHEN** `/img?url=` targets a resource served as `image/svg+xml`
- **THEN** the proxy SHALL return it with its declared type and the image isolation headers
