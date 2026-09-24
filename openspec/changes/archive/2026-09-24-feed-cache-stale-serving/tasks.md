## 1. Server cache

- [x] 1.1 Cache successful feed responses regardless of `Set-Cookie` or `Vary: *`, keeping the 2 MB limit.
- [x] 1.2 Compute freshness from the 15-minute floor, header hints and feed-body hints, capped at 24 hours, including after `304` revalidation.
- [x] 1.3 Retain entries for 24 hours after freshness in memory and the Worker Cache API.
- [x] 1.4 Serve the retained representation with `X-Sift-Cache: stale`, `Age` and `X-Sift-Retry-After` on transient revalidation failure and during URL or origin cooldowns; pass the headers through `/feed`.
- [x] 1.5 Cover the above with server tests and update tests whose expectations change.

## 2. Client

- [x] 2.1 Record local-only `sourceFetchedAt` and `nextCheckAt` from `/feed` responses and preserve them across sync merges.
- [x] 2.2 Suppress the sidebar warning for transient failures when the feed was received within 24 hours, while still recording backoff.
- [x] 2.3 Show the updated time and next check in the feed editor.
- [x] 2.4 Cover the client behaviour with tests.

## 3. Wrap-up

- [x] 3.1 Update README text on feed caching if affected; run typecheck, lint and tests.
- [x] 3.2 Validate, sync and archive the change.
