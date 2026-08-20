## 1. Server: sync-key fingerprint helper

- [x] 1.1 Add `syncKeyFingerprint(syncKey: string): Promise<string>` to `server/sync/tokens.ts`, sharing the existing Crockford digest logic (refactor `tokenFingerprint` to use a common internal helper)
- [x] 1.2 Unit test in `tests/sync-tokens.test.ts`: `syncKeyFingerprint(key)` equals browser `fingerprintSyncKey(key)` for the same key (fixed vector)

## 2. Server: GET /sync/status

- [x] 2.1 Add authenticated `GET /sync/status` route in `server/sync/routes.ts`, mounted with `requirePrincipal` (works for master keys and agent tokens), returning `{ groupFingerprint: await syncKeyFingerprint(syncKey) }`
- [x] 2.2 D1 test: mint code → redeem token → `GET /sync/status` with the token → 200 and `groupFingerprint` equals `fingerprintSyncKey(syncKey)`; master key works too
- [x] 2.3 Test: `GET /sync/status` without auth → 401

## 3. CLI: status shows group code

- [x] 3.1 Add `status(token)` to `packages/siftctl/src/api.ts` calling `/sync/status`; 404 → `{ groupFingerprint: null }` (graceful), other non-OK → `ApiError`
- [x] 3.2 Wire into `cmdStatus` in `packages/siftctl/src/cli.ts`: when paired, fetch group fingerprint; text output prints `Group: XK7B`; `--json` adds `groupFingerprint` (null when unavailable); token fingerprint stays in JSON
- [x] 3.3 Update `tests/siftctl.test.ts`: status text shows `Group:` line; `--json` includes `groupFingerprint`; server 404 → null + exit 0; keep existing assertions passing

## 4. Verify

- [x] 4.1 `npm test`, `npm run typecheck`, `npm run lint`, `npm run build --workspace siftctl`
- [x] 4.2 Manual: `siftctl status` against the deployed server shows `Group:` matching Settings; against an old server (404) still exits 0
