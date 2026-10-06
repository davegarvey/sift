## 1. Guard

- [x] 1.1 Add `server/proxy-guard.ts` with the same-site check, the bounded process-local limiter, the Workers binding path with local fallback, client-address normalisation and throttled rejection diagnostics.
- [x] 1.2 Mount the guard on `/feed`, `/article` and `/img` inside the isolation middleware, with separate fetch and image budgets.
- [x] 1.3 Resolve the client address per adapter: `CF-Connecting-IP` on Workers, the socket address on Node, Bun and the dev server, and `TRUST_PROXY_HOPS` for `X-Forwarded-For`.
- [x] 1.4 Add the `PROXY_FETCH_LIMITER` and `PROXY_IMAGE_LIMITER` bindings to `wrangler.toml` and pass them from `server/worker.ts`.

## 2. Body caps

- [x] 2.1 Add a byte-counting stream cap and reject declared oversize `Content-Length` for `/article` (5 MiB) and `/img` (10 MiB).

## 3. Documentation

- [x] 3.1 Document the limits, caps, `TRUST_PROXY_HOPS` and the recommended Cloudflare billing alert in the README, and add the setting to `.env.example`.
- [x] 3.2 Update `server/log.ts` with the new diagnostic.

## 4. Verification

- [x] 4.1 Test each `Sec-Fetch-Site` value and isolation headers on every new rejection.
- [x] 4.2 Test the limit, `Retry-After`, recovery, separate budgets and independent clients.
- [x] 4.3 Test that rejected requests make no upstream request and do not reach the origin governor.
- [x] 4.4 Test the binding path, the fallback when the binding is absent or throws, and `X-Forwarded-For` handling.
- [x] 4.5 Test declared and streamed oversize bodies, and bodies at the cap, for `/article` and `/img`.
- [ ] 4.6 Run typecheck, lint, tests, build, spec validation and the smoke tests.
- [ ] 4.7 In a browser, add feeds, refresh, open an image-heavy article and search without being limited.
- [ ] 4.8 Validate the OpenSpec change with strict validation.
