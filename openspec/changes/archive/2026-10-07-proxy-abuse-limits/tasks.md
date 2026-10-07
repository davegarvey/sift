## 1. Guard

- [x] 1.1 Add `server/proxy-guard.ts` with the same-site check, the bounded process-local limiter, the Workers binding path with local fallback, client-address normalisation and throttled rejection diagnostics.
- [x] 1.2 Mount the guard on `/feed`, `/article` and `/img` inside the isolation middleware, with separate fetch and image budgets.
- [x] 1.3 Resolve the client address per adapter: `CF-Connecting-IP` on Workers, the socket address on Node, Bun and the dev server, and `TRUST_PROXY_HOPS` for `X-Forwarded-For`.
- [x] 1.4 Add the `PROXY_FETCH_LIMITER` and `PROXY_IMAGE_LIMITER` bindings to `wrangler.toml` and pass them from `server/worker.ts`.

## 2. Body caps

- [x] 2.1 Add bounded response handling and reject declared oversize `Content-Length` for `/feed` (2 MiB), `/article` (5 MiB) and `/img` (10 MiB).
- [x] 2.2 Ensure an oversized feed is rejected without reading or caching its full body.

## 3. Sync limit address

- [x] 3.1 Use Cloudflare's `CF-Connecting-IP` only for sync IP limits; ignore `X-Forwarded-For` and test the fallback.

## 4. Documentation

- [x] 4.1 Document the limits, caps, `TRUST_PROXY_HOPS` and the recommended Cloudflare billing alert in the README, and add the setting to `.env.example`.
- [x] 4.2 Update `server/log.ts` with the new diagnostic.

## 5. Verification

- [x] 5.1 Test each `Sec-Fetch-Site` value and isolation headers on every new rejection.
- [x] 5.2 Test the limit, `Retry-After`, recovery, separate budgets and independent clients.
- [x] 5.3 Test that rejected requests make no upstream request and do not reach the origin governor.
- [x] 5.4 Test the binding path, the fallback when the binding is absent or throws, and forwarded-address handling.
- [x] 5.5 Test declared and streamed oversize bodies, and bodies at the cap, for all three proxy endpoints.
- [x] 5.6 Test sync IP limits ignore `X-Forwarded-For`.
- [x] 5.7 Run typecheck, lint, tests, build, spec validation and the smoke tests.
- [x] 5.8 In a browser, add feeds, refresh, open an image-heavy article and search without being limited.
- [x] 5.9 Validate the OpenSpec change with strict validation.
- [x] 5.10 After merge, verify both Workers rate limiting bindings in the deployed Cloudflare Worker. `PROXY_FETCH_LIMITER` and `PROXY_IMAGE_LIMITER` are present in the deployed `wrangler.toml`; the production Workers build succeeded, and the live Worker returns the proxy guard's cross-site 403 with isolation headers.
