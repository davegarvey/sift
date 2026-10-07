## 1. Server

- [x] 1.1 Add isolation middleware to `/feed`, `/article` and `/img` setting the sandboxing CSP and `nosniff`.
- [x] 1.2 Route `/feed` upstream errors through the shared plain-text error response and forward only retry and cache-status headers.
- [x] 1.3 Refuse `/img` responses without an `image/*` content type and cancel the unused upstream body.
- [x] 1.4 Update the README privacy section.

## 2. Verification

- [x] 2.1 Test isolation headers on successful, error and locally generated responses for all three endpoints.
- [x] 2.2 Test `/img` refusal of HTML, binary and untyped responses and acceptance of SVG.
- [x] 2.3 Run npm test, npm run typecheck and npm run lint.
- [x] 2.4 In a browser, confirm the app still loads proxied articles and PNG/SVG images, and that a directly opened proxied article has an opaque origin without storage access.
- [x] 2.5 Validate the OpenSpec change with strict validation.
