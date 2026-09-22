## 1. Refresh cadence

- [x] 1.1 Change cadence learning to use newly observed item IDs and elapsed successful-observation time; verify tests cover unchanged large snapshots, new arrivals, and the minimum interval.
- [x] 1.2 Add stable per-feed jitter to background refresh scheduling; verify due feeds are spread without being fetched before their learned intervals.
- [x] 1.3 Ensure manual refresh does not bypass an active server cooldown; verify retry timing from `Retry-After` for 429, 419, and local governor responses.

## 2. Shared origin request policy

- [x] 2.1 Add a common origin-governor interface and runtime-local implementation; verify feed, article, image, discovery, MCP, and redirect requests all acquire an origin slot.
- [x] 2.2 Add the hashed D1 origin reservation and cooldown table with atomic reservation behavior; verify concurrent Worker requests to different paths on one origin share spacing and cooldown state.
- [x] 2.3 Add bounded waiting and local retry responses when an origin reservation exceeds its queue limit; verify rejected requests do not call upstream.
- [x] 2.4 Add scheduled cleanup for expired origin state; verify active reservations and cooldowns survive until expiry and old rows are removed.

## 3. Cooldowns, caching, and diagnostics

- [x] 3.1 Extend origin cooldown handling to 429 and 419 across all proxy paths, including progressive 419 backoff and generated `Retry-After` headers; verify upstream delays are never shortened.
- [x] 3.2 Set `Cache-Control: no-store` on proxy errors and success-only immutable caching for images; verify a cached 429/419 cannot persist as an image response.
- [x] 3.3 Separate Worker Cache API failure-marker keys from successful feed representation keys; verify a cooldown does not replace cached body or validators.
- [x] 3.4 Add safe request-source/status/retry diagnostics and hashed metrics, including allowlisted upstream response metadata useful for distinguishing origin responses from intermediary or local cooldown responses; verify raw URLs, query strings, article IDs, and response bodies are absent from persistent logs.

## 4. Integration and documentation

- [x] 4.1 Update README privacy and cache documentation for origin coordination, cooldown state, and local fallback; verify the text matches Worker and Node/Bun behavior.
- [x] 4.2 Run the relevant focused server and scheduler tests, typecheck, and lint; verify all pass before implementation is considered complete.
