## Why

When a user clicks "Refresh all", they expect the most current state — including feeds added by another synced device. Currently `refreshAll()` only refreshes local feeds from upstream and reloads from IndexedDB; it never pulls remote state from the D1 sync server. This means a synced client can't discover newly added feeds from another device until the 30-second polling interval or a tab visibility change triggers a sync pull.

## What Changes

- Add a `pullNow()` call at the start of `refreshAll()` so the sync server is queried for remote changes before local feeds are refreshed.
- The existing "Sync now" button in settings is unaffected; this change makes the primary refresh CTA also sync.
- `pullNow()` is already a no-op when sync is not configured (returns early if no sync key), so there is no impact for non-synced users.

## Capabilities

### New Capabilities
- `sync-pull-on-refresh`: When the user triggers a manual refresh, the client first pulls remote state from the sync server before refreshing local feeds from upstream.

### Modified Capabilities

None.

## Impact

- `src/state.tsx` — One line added to `refreshAll()`.
- No API or schema changes. No new dependencies.
