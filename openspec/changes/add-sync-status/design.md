## Context

The Sync section (src/components/SettingsDrawer.tsx:136-186) currently renders a toggle, a "Pair this device with an existing sync" [Join] row, and an "Add another device to this sync" [Generate] row. It shows nothing about sync health. Meanwhile:

- `ctx.syncNow` (src/state.tsx:448-451) exists in the AppContext but is referenced by no component — dead code. It also only `await`s the pull; the push is fire-and-forget via `scheduleFlush`, so a "Sync now" action would need to await `flushNow()` to report a truthful outcome.
- `lastSyncAt` is persisted in settings (src/db/types.ts:101) and is a good "last successful pull" proxy, but is only read at boot and never rendered.
- The dirty queue is in-memory after `loadDirty()` and readable via `getDirty()` (src/sync/queue.ts:28-30) — a pending-changes count is available at boot, but nothing consumes it.
- Push failures are only `console.error`ed (src/sync/push.ts:116); pull failures are swallowed at boot (state.tsx:577 in a `void` IIFE with no catch) and on focus/online paths (state.tsx:553, 569, 575 — `pullIfStale` with no catch).
- The standing spec's "exponential backoff" push retry is not implemented: `flushNow` tries once per trigger (push.ts:100-121), `withRetry` only retries 429/401 with a 10s cap (client.ts:44-46), and a failed flush is only re-attempted on the next enqueue-overflow, pull success, or explicit trigger (merge.ts:127).

Spec drift: the standing device-sync spec ("Sync status UI in Settings", add-device-sync) requires a "Pair device" button, a "Last synced" relative time, a "Sync now" button, and a "Regenerate" button. The implementation has none of the last three; this change implements the first two and defers "Regenerate".

## Goals / Non-Goals

**Goals:**
- A user can tell at a glance whether sync is healthy, stale, or failing.
- A user can confirm two devices are in the same group without seeing the credential.
- Persistent state: status truthfully reflects the last attempt, even across reloads.
- Satisfy the drifted "Sync status UI in Settings" spec requirements (Last synced, Sync now).

**Non-Goals:**
- Server-side status endpoint or protocol changes.
- Fix clock skew, add push retry-with-backoff (the standing spec's backoff requirement is unimplemented fiction; entries survive in the dirty set and flush on the next trigger — a retry engine is a separate change), or add a "resync from this device" escape hatch.
- Implement the spec's "Regenerate" button and its dependent requirements ("Regenerate preserves dirty set", "Stolen device recovery") — pre-existing drift, deferred.
- Global/sidebar status indicators, toasts, or badges.

## Decisions

1. **Status store as a module with signals.** `src/sync/status.ts` exports signals `lastPullAt`, `lastPushAt`, `pendingCount`, `lastError`, `lastErrorAt` plus `loadStatus()`/`markPullSuccess(t)`/`markPushSuccess(t)`/`markError(e)`. Pending count is derived from `getDirty().length` (after `loadDirty()`), refreshed on flush success. No context plumbing needed — components import the module directly, matching how `key.ts`/`queue.ts` are consumed.

2. **Persistence.** New meta keys (`sync_last_push_at`, `sync_last_error`, `sync_last_error_at`) alongside the existing `lastSyncAt` (already persisted, serves as last pull time). Persisted on change (debounced, same pattern as `persistDirty`). If IDB writes fail, status degrades to session-only — display never blocks on persistence.

3. **Hook points.** Pull success/failure: `runPull` and `runFirstTimeSetup` in merge.ts — **`markError` must fire in the throw path of `runPull` itself**, since `pullIfStale` callers at state.tsx:553/569/575 are `void`'d with no catch and boot (`state.tsx:577`) is a `void` IIFE. Push success/failure: `flushNow` in push.ts (success → `markPushSuccess` + pending refresh; failure → `markError`).

4. **Display precedence.** Pull and push are tracked separately; a healthy pull must not mask a failing push. Errors are **kind-aware**: `markError('push', e)` / `markError('pull', e)` record the failing kind; `markPullSuccess` clears the error only when it is not a push error, and `markPushSuccess` only when it is not a pull error. (A timestamp-based rule — "error newer than last activity" — was rejected during implementation: a push failure followed by a pull success would clear the error even though the push never succeeded, violating the spec scenario "a later successful pull SHALL NOT clear the error while the failing operation has not succeeded since".)
   - Error state (red, relative time, message) when an error is recorded.
   - Else if `pendingCount > 0` → neutral "N changes waiting to sync" (covers push-stale: pushes failing silently are visible via non-zero pending).
   - Else → "Synced X ago" (relative to the most recent of pull/push).
   - `syncNow` (state.tsx:448) is changed to `await pullNow(); await flushNow();` so the button's try/catch (routing to `markError`) captures the push outcome too — satisfying "Sync now … SHALL record the outcome". `flushNow` is already concurrency-safe (`inFlight` guard, push.ts:101).

5. **Fingerprint.** `fingerprintSyncKey(key)` in `src/sync/key.ts`:

   ```
   SHA-256(key) ──take bytes 0..2──▶ 24 bits ──mask to 20──▶ 4 × 5-bit chars ──▶ Crockford base32
   ```

   Crockford base32 is 32 symbols — `0-9` **and** `A-Z` minus `I`, `L`, `O`, `U` (0 and 1 ARE included; this is distinct from the pairing-OTP alphabet at routes.ts:19, which additionally excludes them). 4 chars × 5 bits = the spec'd 20 bits exactly. Async (`crypto.subtle.digest`), computed reactively from `ctx.syncKey()` when the drawer renders. One-way over a 132-bit random input — display-only, leaks nothing recoverable. 20 bits → collision between two specific groups ≈ 2^-20; irrelevant for a single-user display (no functional use, cosmetic only).

   **Secure-context dependency**: `crypto.subtle` is unavailable outside https/localhost (e.g., self-hosted on LAN http — server/node.ts binds a plain `serve`). `fingerprintSyncKey` MUST be wrapped in try/catch and the fingerprint row omitted (not rendered, no error) when Web Crypto is unavailable. This keeps the determinism guarantee ("same key → same fingerprint") clean — no second derivation algorithm. A throw here must never take down the Sync section.

6. **UI layout (SettingsDrawer `SyncSection`).** Everything existing stays; a status block is inserted after the toggle and before the pairing rows, visible only when sync is enabled:

   ```
   [Enable sync]                    (toggle, unchanged)
   ● Enabled · Group: XK7B       ⧉   (fingerprint + copy button, McpUrlBar pattern; omitted if Web Crypto unavailable)
   Synced 2m ago · 0 pending        (or red: "Sync failed 3h ago — <reason>")
   [Sync now]
   Pair this device …           [Join]       (unchanged)
   Add another device to group XK7B  [Invite] (copy/CTA update)
   ```

   The relative time recomputes every 30s while the drawer is open (existing spec scenario "Last synced updates while drawer is open"). The existing `syncError` inline message for toggle-on failures stays — it covers the enable action; the status line covers ongoing state.

7. **Pairing row copy.** Row 2 becomes "Add another device to group XK7B" with `[Invite]` (matched verb pair Join/Invite). When sync is disabled the row is hidden (already the case).

## Risks / Trade-offs

- [Drift] "Regenerate" and its dependent requirements remain unimplemented. Explicitly deferred; the fingerprint display actually *motivates* Regenerate UI (that's how you'd move a device to a fresh group) — candidate follow-up change.
- [Stale display] Status reflects the *last attempt*, not a live probe. "Synced 2m ago" can coexist with a currently-down server until the next pull fails. Accepted — a live probe would add request noise; the pull-on-boot/focus/online hooks bound the staleness window.
- [Push failure visibility] Without a retry engine, a failed flush is only re-attempted on the next trigger; between triggers the pending count makes it visible. Accepted; retry is a non-goal.
- [Fingerprint omissions] On insecure contexts the fingerprint row silently disappears. Accepted: display-only, and https is the documented deployment for sync (Workers).
- [Fingerprint collisions] 2^-20 collision chance for two specific groups; purely cosmetic, so accepted. Deterministic per key — both devices always show the same string.
- [Persistence failure] If meta writes fail, status is session-only and reverts to blank on reload. Acceptable degradation; no functional impact on sync itself.

## Implementation order

Implement after `fix-sync-first-pairing`: both changes modify `runFirstTimeSetup`/`runPull` in merge.ts. The status hooks land cleanly on top of the rewritten first-time flow; doing them in the other order risks conflicting merge edits.
