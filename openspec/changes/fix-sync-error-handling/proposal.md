## Why

The sync registration per-IP rate limit (10/hr) is too tight for real-world use, and when registration fails the error is completely invisible — the promise chain runs through `void toggleOn()` and any rejection is silently swallowed. Users see "Enable sync" toggle on but no data reaches the server, with no feedback.

## What Changes

- **Bump `registerPerIp` rate limit** from 10 to 100 requests per hour in the server-side rate limiter.
- **`enableSync()` fallback on failure**: if `triggerFirstTime()` throws, call `disableSync()` to clear the sync key so the user can retry with a fresh key.
- **Surface errors in Settings drawer**: catch errors from the sync toggle, log them to console, and display an inline error message in the UI.

## Capabilities

### New Capabilities
- (none — this is a refinement of existing sync)

### Modified Capabilities
- (none — no spec-level requirement changes; only implementation/UX refinements)

## Impact

**Code**:
- `server/sync/ratelimit.ts` — one constant change (10 → 100)
- `src/state.tsx` — add try/catch around `triggerFirstTime()` in `enableSync`
- `src/components/SettingsDrawer.tsx` — add error signal and catch block in `toggleOn`

**No API, schema, or behavior changes** for the sync protocol. The rate limit is more generous but otherwise identical. The error catch is additive.
