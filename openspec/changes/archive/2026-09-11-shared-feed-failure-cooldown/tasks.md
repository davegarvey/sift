## 1. Shared Failure State

- [x] 1.1 Add the `feed_fetch_failures` D1 migration with hashed URL key, status, retry timestamp, update timestamp, and retry index; verify the migration applies cleanly and is additive to the sync schema
- [x] 1.2 Add the adapter-independent shared failure-state module with idempotent runtime schema bootstrap and SHA-256 URL keys; verify raw upstream URLs and feed bodies are absent from stored rows
- [x] 1.3 Extend the local D1 shim for the new table and add daily cleanup of expired failure rows; verify local schema, insert, lookup, delete, and cleanup paths

## 2. Feed Proxy Behavior

- [x] 2.1 Classify only upstream `4xx`/`5xx` responses as cooldown-worthy, represent network and timeout failures as `502`, and leave `2xx`/`3xx` responses outside cooldown; verify `419`, redirect, and network-error scenarios
- [x] 2.2 Apply bounded `Retry-After` or 30-minute fallback delays and return recorded status plus remaining `Retry-After` without contacting upstream during cooldown; verify retry-delay and no-repeat tests
- [x] 2.3 Wire shared D1 failure lookup and recording into `/feed` while retaining in-memory and Worker Cache API fast paths and fail-open behavior when D1 is unavailable; verify cross-user/isolate behavior with a shared D1 test
- [x] 2.4 Clear active local failure state after successful `200`/`304` revalidation without adding an unconditional D1 write to every successful refresh; verify recovery and successful-cache regression tests

## 3. Compatibility and Documentation

- [x] 3.1 Preserve successful representation caching, validators, browser-local parsing, Node/Bun operation without D1, and sync data boundaries; verify the existing feed-cache, proxy, and sync test suites
- [x] 3.2 Update README and migration documentation with the failure metadata privacy boundary and cooldown behavior; verify documentation matches the finalized main specs

## 4. Validation and Spec Lifecycle

- [x] 4.1 Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` with zero failures
- [x] 4.2 Validate the completed OpenSpec change in strict mode and resolve any spec or implementation divergence before syncing
- [x] 4.3 Sync the approved delta specs into `openspec/specs/`, verify the main specs no longer contradict shared failure cooldown behavior, then archive the completed change
