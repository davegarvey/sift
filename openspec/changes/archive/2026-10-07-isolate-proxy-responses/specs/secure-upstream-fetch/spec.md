## ADDED Requirements

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
