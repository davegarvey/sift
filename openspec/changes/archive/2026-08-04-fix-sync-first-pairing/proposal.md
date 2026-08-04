## Why

A device that joins a sync group with pre-existing local data re-uploads ALL of its local feeds and tags with fresh `Date.now()` timestamps. The server clears tombstones unconditionally on any feed upsert and applies per-field last-writer-wins, so the joining device overwrites newer group state, resurrects feeds deleted on other devices, and reverts tags. If the follow-up pull fails, `lastSyncAt` stays null and every app boot re-runs the same destructive re-upload — a silent, self-perpetuating loop.

## What Changes

- First-time setup becomes **pull-first and diff-based**: the client pulls server state (`since=0`) and pushes only the local feeds and flags the server does not already have. This applies to every first-time setup, including re-enable with a fresh key.
- Feeds are matched by **`feed_id` or URL** (a URL-only match is defeated by renamed-then-deleted feeds); flags are matched by **normalized item ID** (server `item_id` decoded via `decodeItemId`). Existing group rows are never re-stamped with synthetic client timestamps, so a stale device can no longer overwrite newer group state or resurrect tombstones.
- The empty-payload re-upload heuristic in `runFirstTimeSetup` (recovery for a wiped server) is removed; the uniform diff covers both no-change and wiped-server cases.
- **Standing-spec implementation**: `disableSync` now also clears `lastSyncAt` and the dirty set ("Dirty set cleared on toggle off" was unimplemented), and `triggerFirstTime` starts with an empty dirty set — fixing stale-cursor failures and cross-group flag bleed on re-enable.
- No UI changes.

## Capabilities

### New Capabilities
*(none)*

### Modified Capabilities
- `device-sync`: The **First-time setup ordering** requirement currently mandates "push all local state to the server"; this change replaces that with non-destructive, diff-based upload and adds clean-slate re-enable semantics.

## Impact

- `src/sync/merge.ts` — rework `runFirstTimeSetup` / `pushLocalState` to always pull-first + diff
- `src/state.tsx` — `disableSync` clears `lastSyncAt` + dirty set; `triggerFirstTime` starts clean
- `tests/sync-pairing-e2e.test.ts` — existing pairing tests need *extension* (the two called out in tasks pass unchanged on empty-server setups; the populated-server, tombstone, and normalization cases are new coverage); several new scenarios added
- No server, protocol, schema, or UI changes
