## Context

The sync registration endpoint (`POST /sync/register`) is protected by a per-IP rate limit of 10 requests per hour (`server/sync/ratelimit.ts:53`). This is hit easily during development when a user toggles sync on/off repeatedly (each toggle generates a new key and triggers a register call via the push auto-register flow). Once the limit is exhausted, all register attempts return 429, the push auto-retry in `client.ts:pushChunk` silently fails, and no data reaches D1. The error is invisible to the user because `SettingsDrawer.toggleOn` is called via `void toggleOn()` with no catch, and `enableSync` in `state.tsx` has no try/catch around `triggerFirstTime()`.

The fix involves three isolated changes: a server-side limit bump, a client-side guard in the enable path, and UI-level error surfacing.

## Goals / Non-Goals

**Goals:**
- Increase `registerPerIp` limit to a value that accommodates normal testing without exhausting the quota.
- Ensure that if `enableSync()` fails (for any reason), the sync key is cleared so a retry generates a fresh one.
- Show the user a visible error message in the Settings drawer when enabling sync fails.
- Log the error to the browser console for debugging.

**Non-Goals:**
- Overhaul the sync error propagation architecture (e.g., adding toast notifications system-wide).
- Change the sync protocol, wire format, or D1 schema.
- Add server-side rate limit telemetry or observability.

## Decisions

1. **Rate limit: 10 → 100/hr.** The original limit was conservative (10/hr). 100/hr is still conservative for a personal reader but eliminates false positives during testing. Even at 100/hr, a single user would never hit this in normal use. The register endpoint also has a global daily cap (1000/day) and an absolute user count cap (100,000), which remain unchanged as backstops.

2. **`enableSync()` clears key on failure.** If `triggerFirstTime()` throws, call `await disableSync()` (which sets `syncKey: null, lastSyncAt: null` in settings) before rethrowing. This ensures the toggle shows as OFF on failure and the next attempt generates a fresh key (rather than retrying the same stale key which would just 401 again).

3. **Error surfacing in SettingsDrawer.** A local `syncError` signal in `SyncSection` is set in a try/catch around `toggleOn`. The error message is rendered below the toggle. This is the minimal change — no new error infrastructure, just a `<Show when={syncError()}>` block. Console error logging (`console.error`) is added for developer debugging.

## Risks / Trade-offs

- [Minor UX] The error message is only visible while the Settings drawer is open. If the user closes the drawer, the error is lost. This is acceptable since the toggle will be OFF (disabled) anyway, and the user must open the drawer to retry.
- [False sense of success] If `enableSync()` succeeds from the UI's perspective but the initial push silently drops some entries (e.g., 413 splitting edge case), the user won't know. This is a pre-existing concern, not introduced by this change.
