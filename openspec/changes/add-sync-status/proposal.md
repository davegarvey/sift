## Why

Sync state is invisible in the app: there is no last-sync time, no pending-changes count, no error display, and the "Sync now" action exists in context but has no button. When a device stops syncing (or never started), the user cannot distinguish "synced, healthy" from "silently stale" — exactly the failure mode that produced stale feeds and tags on a second device. The standing `device-sync` spec already requires a "Last synced" time, a "Sync now" button, and a "Regenerate" button in Settings (add-device-sync spec, "Sync status UI in Settings"); those were never implemented, so this change partially closes that drift (Last synced + Sync now; Regenerate is deferred).

## What Changes

- **Sync status store** (`src/sync/status.ts`, new): persistent, reactive state — last successful pull, last successful push, pending-change count, last error + timestamp — hooked into the boot, pull, and push paths. Pull and push are tracked separately so a healthy pull cannot mask a failing push.
- **Group fingerprint**: a short, display-only identifier derived from the sync key — SHA-256 of the key truncated to 20 bits, rendered as 4 Crockford base32 characters (e.g. `XK7B`). The key itself is the auth credential and is never displayed. Omitted gracefully when the Web Crypto API is unavailable (insecure contexts such as LAN http).
- **Settings → Sync section**: a status block — `Group: XK7B` (copyable), a status line (`Synced 2m ago · 0 pending` or `Sync failed 3h ago`), and a **Sync now** button wired to `ctx.syncNow` (updated to await the push flush so the outcome is truthful).
- **Pairing row copy/CTA**: "Add another device to this sync" → "Add another device to group XK7B" with CTA `[Generate]` → `[Invite]`. The "Pair this device" row is unchanged.

## Capabilities

### New Capabilities
*(none — extends existing capability)*

### Modified Capabilities
- `device-sync`: Extend **Sync status UI in Settings** with the group fingerprint, persistent status line (last sync, pending changes, last error), and the missing "Sync now" button; update pairing-row copy.

## Impact

- `src/sync/status.ts` — new persistent reactive status store
- `src/sync/key.ts` — `fingerprintSyncKey()` helper
- `src/sync/init.ts`, `src/sync/merge.ts`, `src/sync/push.ts` — status hook calls (success/failure)
- `src/components/SettingsDrawer.tsx` — status block, Sync now button, row copy/CTA
- No server, protocol, or schema changes
