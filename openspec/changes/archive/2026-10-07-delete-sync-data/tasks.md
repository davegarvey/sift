## 1. Server deletion

- [x] 1.1 Add `server/sync/account.ts` with the per-account delete statements (flags, feed statistics, feeds, tokens, pairing codes, keyed rate-limit scopes, user) and `KEYED_RATE_LIMIT_PREFIXES` in `ratelimit.ts`.
- [x] 1.2 Add `DELETE /sync/account` behind `requireMaster` with a per-key rate limit (`RATE_LIMITS.accountDelete`).
- [x] 1.3 Record pull activity in `users.last_active_at` whether or not polling is enabled.
- [x] 1.4 Add migration `0010_feeds_live_url_index.sql` and mirror it in `ensureSchema`.

## 2. Polling

- [x] 2.1 Add `removeUnsubscribedPolledFeeds` to `server/poll-registry.ts` and call it, best-effort, after the account batch.

## 3. Retention

- [x] 3.1 Delete accounts rotated more than 30 days ago and accounts inactive for 365 days in `runSyncCron`, in bounded per-account batches, rotated first, at most 50 per run.
- [x] 3.2 Fix the local D1 shim's null comparisons, anchored `IS NULL` clauses and `LIMIT` so the retention queries behave as in D1.

## 4. Client

- [x] 4.1 Add `deleteSyncAccount()` and a fixed message for `401` responses to the sync client.
- [x] 4.2 Stop automatic pulls and debounced pushes while the server rejects the key, show the message in Settings, and reset on success or when sync is disabled.
- [x] 4.3 Add the "Delete sync data" action to the Sync section, with its confirmation, and correct the disable-sync confirmation.

## 5. Documentation

- [x] 5.1 Document `DELETE /sync/account` in `public/openapi.json`.
- [x] 5.2 Update the README (sync description, deletion route, retention periods, privacy section) and the migrations README.

## 6. Tests and verification

- [x] 6.1 Cover deletion, isolation, repeat and unauthorised requests, rate limiting, token revocation, polling cleanup and retention against Miniflare D1, and the same routes on the shim.
- [x] 6.2 Cover the client delete flow, the Settings confirmations and the rejected-key behaviour.
- [x] 6.3 Run typecheck, lint, unit tests, build, spec validation and smoke tests.
