## Why

The `/feed`, `/article` and `/img` proxies served upstream content from Sift's own origin without isolation. `/article` labelled any upstream page `text/html`, `/feed` served upstream XML (which can be XHTML), `/img` passed through any upstream type, and error paths forwarded upstream headers. A crafted proxy link opened in a browser could therefore run upstream script on Sift's origin and read IndexedDB, including the sync key, and an upstream could set cookies on Sift's domain.

## What Changes

- Add a sandboxing `Content-Security-Policy` and `X-Content-Type-Options: nosniff` to every `/feed`, `/article` and `/img` response, including conditional, error and locally generated responses.
- Return upstream error responses as plain text, forwarding only Sift's retry and cache-status headers.
- Refuse `/img` upstream responses that do not declare an `image/*` type.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `secure-upstream-fetch`: add response isolation, error header filtering and image type enforcement.

## Impact

`server/handle.ts`, `server/fetch.ts` (exports the existing body-cancel helper), proxy tests and the README privacy section. The browser client reads proxy responses through `fetch()` and `<img>`, which these headers do not affect. Images from servers that send `application/octet-stream` or no content type will no longer load.

## Non-goals

Per-client rate limiting, response size caps, restricting proxy use to Sift's own pages, and authentication for the proxy.
