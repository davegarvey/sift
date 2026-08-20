## Context

The sync system already has a group identifier: the browser computes `fingerprintSyncKey(key)` (`src/sync/key.ts`) — SHA-256 of the sync key, first 20 bits, rendered as 4 Crockford base32 characters — and Settings shows it as `Group XK7B`. Every device in a group shares the sync key, so the code matches across devices.

`siftctl` shows a *token* fingerprint instead (`tokenFingerprint` in `packages/siftctl/src/fingerprint.ts`, mirrored server-side in `server/sync/tokens.ts`). Tokens are per-device: `POST /sync/tokens/redeem` mints a fresh token per pairing. So `siftctl status` on two devices in the same group shows two different codes — the CLI can't currently answer "are these devices in the same group?".

## Decisions

1. **Server derives the group code.** The `tokens` table stores each token's `sync_key`, so the server can compute the group fingerprint without exposing the key. Add an authenticated `GET /sync/status` route (mounted with the existing `requirePrincipal` middleware, so both master keys and agent tokens work) returning `{ groupFingerprint }`.

2. **Byte-identical to the browser scheme.** Reuse the existing Crockford logic from `server/sync/tokens.ts` (`tokenFingerprint` already implements exactly this scheme over an arbitrary input). Extract/export a `syncKeyFingerprint` helper that runs the same digest over the sync key, guaranteeing `siftctl status` shows the same string as Settings.

3. **CLI keeps token fingerprint in JSON, leads with group in text.** The per-token fingerprint still matches the Settings agents list (useful for "which agent am I"); keep it in `--json` output. The human-readable `status` output gets a `Group: XK7B` line.

4. **Graceful degradation.** If the server returns 404 (predates the endpoint), the CLI omits the group line and sets `groupFingerprint: null` in JSON — `status` must never fail on an old server. Any other non-OK status propagates as an `ApiError` like the existing calls.

## Sequence

- Server: add `syncKeyFingerprint` helper → add `GET /sync/status` route → test in `tests/sync-tokens.test.ts` (mint → redeem → status with token → fingerprint equals browser `fingerprintSyncKey`; 401 without auth).
- CLI: add `status()` to `api.ts` → wire into `cmdStatus` → tests in `tests/siftctl.test.ts` (text shows `Group:`; JSON has `groupFingerprint`; 404 → null, exit 0).

## Risks

- **Endpoint age**: a deployed server without `/sync/status` must not break `siftctl status` — handled by 404 → null.
- **Scheme drift**: server and browser fingerprint logic could diverge — mitigated by reusing the existing single server implementation and asserting equality with the browser helper in tests.
