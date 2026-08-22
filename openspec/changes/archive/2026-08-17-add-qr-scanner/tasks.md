## 1. Setup

- [x] 1.1 Add `jsqr` dependency to `package.json` (done)
- [x] 1.2 Add `sync-join` and `sync-share` modal kinds to `state.tsx` ModalKind union
- [x] 1.3 Render `SyncJoinModal` and `SyncShareModal` in `App.tsx` under `Backdrop`

## 2. SyncJoinModal

- [x] 2.1 Create `src/components/SyncJoinModal.tsx` with modal shell (header, body, footer)
- [x] 2.2 Add 8-char code text input + Pair button with validation
- [x] 2.3 Add "Scan QR" button, disabled when no camera (`enumerateDevices()`)
- [x] 2.4 Integrate `QrScannerOverlay` (conditionally rendered inside modal)
- [x] 2.5 On scan success: close join modal → open `PairResultModal`
- [x] 2.6 Show inline error/success states for pairing
- [x] 2.7 Cleanup scanner on modal close

## 3. SyncShareModal

- [x] 3.1 Create `src/components/SyncShareModal.tsx` with modal shell
- [x] 3.2 Auto-generate pairing code on open (`issueOtp()`)
- [x] 3.3 Schedule auto-refresh `setTimeout(expiresAt - now)` → `generateCode()`
- [x] 3.4 Add countdown ring: 1s interval, fraction calc, red < 30s
- [x] 3.5 Position ring at bottom-right of modal body (shared between code + QR)
- [x] 3.6 Display pairing code in monospace block
- [x] 3.7 Display QR code via `renderSyncKeyQr()`
- [x] 3.8 Add Copy button for the code
- [x] 3.9 Cleanup timers on close (`onCleanup`)

## 4. Settings Drawer Strip

- [x] 4.1 Remove all inline sync state from `SyncSection` (move to modals)
- [x] 4.2 Replace sync content with toggle + "Join existing sync" / "Add another device" buttons
- [x] 4.3 Keep `toggleOn`/`toggleOff` + `syncError` in SyncSection
- [x] 4.4 Remove `QrScannerOverlay` import from SettingsDrawer

## 5. CSS

- [x] 5.1 Move `.sync-grid`, `.code-timer`, `.sync-grid__*` styles out of settings section
- [x] 5.2 Adjust `.scanner-overlay` styles if needed for nesting inside SyncJoinModal
- [x] 5.3 Add `.sync-share-modal-body` as `position: relative` for ring anchor
- [x] 5.4 Ensure `.code-timer` positioning works at bottom-right of modal

## 6. Polish

- [x] 6.1 Run `npm run typecheck` and fix any errors
- [x] 6.2 Run `npm run lint` and fix any warnings
