## 1. Status store

- [x]1.1 Create `src/sync/status.ts`: signals (`lastPullAt`, `lastPushAt`, `pendingCount`, `lastError`, `lastErrorAt`), `loadStatus()`, `markPullSuccess(t)`, `markPushSuccess(t)`, `markError(e)`, and debounced persistence to meta keys (`sync_last_push_at`, `sync_last_error`, `sync_last_error_at`)
- [x]1.2 Derive `pendingCount` from `getDirty().length` after `loadDirty()`, refreshed after each flush
- [x]1.3 Hook pull success/failure in `runPull` and `runFirstTimeSetup` (src/sync/merge.ts); `markError` MUST fire in the throw path of `runPull` itself, because `pullIfStale` callers (state.tsx:553/569/575) and boot (state.tsx:577) have no catch
- [x]1.4 Hook push success/failure in `flushNow` (src/sync/push.ts): success → `markPushSuccess` + pending refresh; failure → `markError`
- [x]1.5 Implement display precedence in the component: error state when `lastErrorAt` is newer than both `lastPullAt` and `lastPushAt`; otherwise pending count when non-zero; otherwise last activity

## 2. Fingerprint

- [x]2.1 Add `fingerprintSyncKey(key: string): Promise<string>` to `src/sync/key.ts` (SHA-256 → first 3 bytes → mask to 20 bits → 4 Crockford base32 chars; alphabet `0-9 A-Z` minus `I L O U`, which includes `0` and `1`)
- [x]2.2 Guard with try/catch: throw/reject if `crypto.subtle` is unavailable; the component SHALL omit the fingerprint row in that case
- [x]2.3 Add unit tests: deterministic output, 4 chars, only Crockford alphabet chars, differs for different keys, rejects/throws when `crypto.subtle` is undefined (mock)

## 3. Settings UI

- [x]3.1 In `SyncSection` (SettingsDrawer.tsx), add a status block visible when sync is enabled: fingerprint row with copy control (reuse the McpUrlBar copy pattern; omitted when Web Crypto unavailable), status line, and "Sync now" button
- [x]3.2 Wire "Sync now" to an awaited `pullNow()` + `flushNow()` (update `syncNow` in state.tsx:448), with try/catch routing failures to `markError`
- [x]3.3 Render error state in red with relative time; render pending count when non-zero (never a healthy "Synced" state while pending); recompute relative times every 30s while the drawer is open
- [x]3.4 Update row 2 copy to "Add another device to group `<fingerprint>`" and CTA `[Generate]` → `[Invite]`; leave row 1 untouched
- [x]3.5 Keep the existing toggle-on `syncError` inline message as-is

## 4. Verify

- [x]4.1 Run `npm test`, `npm run typecheck`, `npm run lint`
- [ ] 4.2 Manual check: enable sync, open Settings — fingerprint matches on a second paired device; kill network, trigger a pull, confirm error state renders and persists across reload; confirm fingerprint row omits gracefully when `crypto.subtle` is unavailable
- [x]4.3 Confirm `syncNow` reports push failures (flush error surfaces via the button's catch, not just the pull)

## 5. Verification follow-up (post-verify)

- [x] 5.1 Add unit tests for status store persistence and kind-aware error precedence (tests/sync-status.test.ts)
