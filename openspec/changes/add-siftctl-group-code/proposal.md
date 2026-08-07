## Why

The web app's Settings shows `Group XK7B` — a fingerprint of the *sync key*, identical on every device in the group, so a user can confirm two devices belong to the same sync group. `siftctl status` instead shows a fingerprint of the *agent token*, and each device gets its own token at pair time (`server/sync/tokens.ts` mints a new one per redeem). Two devices in the same group therefore show *different* codes in the CLI — confusing when the CLI is the tool being used to compare.

## What Changes

- **Server: `GET /sync/status`** (authenticated; token or master key) returns `{ groupFingerprint }` — the first 20 bits of the SHA-256 digest of the sync key, rendered as 4 Crockford base32 characters, byte-identical to the browser's `fingerprintSyncKey` scheme (`src/sync/key.ts`). The server knows each token's `sync_key`, so it can derive the group code without exposing the key.
- **CLI: `siftctl status`** calls `/sync/status` when paired and prints `Group: XK7B` alongside the existing `Sync`/`URL`/`Paired` lines; `--json` adds `groupFingerprint`. The per-token `fingerprint` stays in JSON (it matches the Settings agents list) but the human-readable output leads with the group code.
- **Graceful degradation**: when the server predates the endpoint (404), the CLI omits the group line / sets `groupFingerprint: null` rather than failing — so old servers don't break `status`.

## Capabilities

### New Capabilities
- `device-sync`: Add **siftctl group code** — `siftctl status` SHALL display the group fingerprint (sync-key-derived), matching the web app's group code, so a CLI user can confirm two devices are in the same sync group.

### Modified Capabilities
*(none)*

## Impact

- `server/sync/tokens.ts` — export a sync-key fingerprint helper (reusing the Crockford scheme)
- `server/sync/routes.ts` — new authenticated `GET /sync/status` route
- `packages/siftctl/src/api.ts` — `status()` client call
- `packages/siftctl/src/cli.ts` — status output + JSON field
- `tests/sync-tokens.test.ts`, `tests/siftctl.test.ts` — tests
