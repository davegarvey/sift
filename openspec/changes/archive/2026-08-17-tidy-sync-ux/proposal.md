## Why

The sync UI grew organically and its confirmation and pairing UX are now inconsistent: a 3-second button-label morph for "Regenerate" that silently re-arms and offers no cancel, a second morph for agent revocation, a native `confirm()` dialog for OPML import, and two separate pairing modals (Join / Invite) for what is a single direction-agnostic protocol. Meanwhile the `device-sync` spec has drifted from the implementation: it mandates a unified pairing modal, a disable-sync confirmation, and a key-backup prompt that the code never implemented. This change tidies the sync surface end to end and re-aligns the spec with reality.

## What Changes

- **Generic confirmation modal** — one `ConfirmModal` (payload-driven, same skeleton as the existing unsubscribe dialog: header, message, subtle Cancel + danger action) replaces:
  - the "Regenerate" → "Confirm" label morph (Settings drawer) — consequence text moves into the modal, the 3s timer disappears;
  - the "Revoke" → "Confirm" morph (Agents modal), with return to the refreshed agent list after;
  - the native `confirm()` for OPML import (preview stats in the modal);
  - the dedicated `ConfirmUnsubscribeModal` component (converted to the generic kind);
  - **new**: disabling sync now requires confirmation with the spec-mandated text ("Your other devices will stop syncing. Server data is kept until you generate a new key. Continue?"), which was specified but never implemented.
- **Settings drawer Sync section** — the group fingerprint row (display-only value with a misleading copy affordance) is deleted; the fingerprint folds into the status line (`Synced 2 min ago · Group XK7B`). Status moves to the top; Join + Invite collapse into one "Pair another device" row; label voice unified ("Agent access"); the Regenerate row becomes a visually separated danger zone with a short label. Fixes: global `.error` styling (currently unstyled — only a scoped `.add-feed .error` exists), error text moved out of flex rows, dead `border-top: 0` inline styles removed.
- **One pairing modal** — `SyncJoinModal` + `SyncShareModal` merge into a single `PairDeviceModal` that is role-driven by this device's state: a device with a sync key opens it in source mode (OTP code + QR, grouped `abcd-efgh` display, expiry ring); a device without one opens it in receiving mode (code or 22-character key input with Enter-to-submit, plus the existing camera scan path). The two directions are never presented as parallel options — the receiving direction is reachable from source mode via a secondary link. A "Join an existing sync" row in the disabled Sync section closes the gap that previously left fresh devices with no entry point. The `/?pair=` deep-link flow is untouched.
- **Pairing modal polish** — code refresh failures surface an error + retry instead of silently clearing; countdown clamps to "<1 min" instead of "Expires in 0 min".
- **Agents modal polish** — empty right grid column fixed (single-column layout), footer copy fixed to match the generated prompt ("read your feeds and propose additions", not "read and change your subscriptions"), expiry line moved next to the code.
- **Spec alignment** — the `device-sync` spec's "Unified pairing modal" and "Sync status UI in Settings" requirements are rewritten to match the implemented system; a "Key backup prompt" requirement already exists in the spec and is **not** implemented by this change (flagged for a follow-up).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `device-sync`: rewrite the "Unified pairing modal" requirement to describe the single merged modal (source half + target half, code-or-key input, no device detection); rewrite "Sync status UI in Settings" (status line with group fingerprint, single "Pair device" row, regenerate via confirmation modal, disable-sync confirmation, agent access row with revoke confirmation); paste-flow scenarios ("Pairing via paste") become satisfied by the merged modal's key input.

## Impact

- `src/components/`: new `ConfirmModal.tsx`, new `PairDeviceModal.tsx`; deleted `SyncJoinModal.tsx`, `SyncShareModal.tsx`, `ConfirmUnsubscribeModal.tsx`; edits to `SettingsDrawer.tsx`, `AgentsModal.tsx`, `FeedEditorModal.tsx`, `App.tsx`.
- `src/state.tsx`: `ModalKind` gains `confirm` and `pair-device`; `sync-join`/`sync-share`/`confirm-unsubscribe` removed.
- `src/styles.css`: global `.error`, single-column sync-grid modifier, danger-zone separator.
- No server, protocol, or storage changes.
