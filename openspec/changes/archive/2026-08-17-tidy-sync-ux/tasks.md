# Tasks

## 1. ConfirmModal infrastructure

- [x] 1.1 Add `{ kind: 'confirm'; title; message; hint?; confirmLabel; danger?; onConfirm; returnTo? }` to `ModalKind` in `src/state.tsx`; remove `confirm-unsubscribe`, `sync-join`, `sync-share`
- [x] 1.2 Create `src/components/ConfirmModal.tsx` (header / body / hint subtext / subtle Cancel + danger action; Cancel and confirm paths honor `returnTo` chaining)
- [x] 1.3 Wire `ConfirmModal` in `src/App.tsx`; make the global Escape handler and `Backdrop` click handler honor `returnTo` for `kind === 'confirm'`; delete `ConfirmUnsubscribeModal.tsx` and its Show block
- [x] 1.4 Convert `FeedEditorModal.tsx` unsubscribe to the generic confirm kind (copy verbatim, no returnTo)

## 2. Settings drawer sync section

- [x] 2.1 Add global `.error` rule and unify `.add-feed .error` to `var(--red)`; add `.settings .row.danger` separator; add `.sync-grid--single` modifier (CSS)
- [x] 2.2 Delete fingerprint row + copy affordance; render fingerprint as suffix on the status line; reorder rows (status, Pair, Agent access, Regenerate)
- [x] 2.3 Replace regenerate label-morph with confirm modal (short label, `returnTo` settings); delete `confirmRegen` signal and 3s timer; remove dead `border-top: 0` inline styles
- [x] 2.4 Add disable-sync confirmation (spec text) via the generic confirm modal, chaining back to settings
- [x] 2.5 Replace native `confirm()` for OPML import with the generic confirm modal (preview stats), chaining back to settings
- [x] 2.6 Move enable-failure error `<p>` out of the flex row; label voice: "Agent access" / "Pair another device"

## 3. Pair device modal

- [x] 3.1 Create `src/components/PairDeviceModal.tsx` (two-column sync-grid: source half OTP+QR+copy+expiry ring; target half code/key form + Pair + Scan QR + inline error)
- [x] 3.2 Target input accepts 8-char code (`redeemCode`) or 22-char key (`pairSyncWithKey` with "Already paired with this key" check); form submits on Enter; validation errors without server call
- [x] 3.3 Move camera availability check + `QrScannerOverlay` usage from `SyncJoinModal`; preserve scan-success and pair-result chaining
- [x] 3.4 Source half: keep auto-refresh-on-expiry; add failure feedback (inline error + retry) instead of silently clearing the code
- [x] 3.5 Clamp countdown to "<1 min" (shared with AgentsModal); delete `SyncJoinModal.tsx` and `SyncShareModal.tsx`; wire `pair-device` in `App.tsx` and the drawer row

## 4. Agents modal

- [x] 4.1 Replace revoke label-morph with generic confirm modal (fingerprint in message, `returnTo` agents modal)
- [x] 4.2 Use `.sync-grid--single` for the code cell; move expiry line under the code; fix footer copy to match the generated prompt; clamp countdown

## 5. Verification

- [x] 5.1 `npm run typecheck` — zero errors
- [x] 5.2 `npm run lint` — zero warnings
- [x] 5.3 `npm test` — all pass
- [x] 5.4 Manual pass in `npm run dev`: enable/disable sync, regenerate (confirm + cancel), pair via code/QR/key, agents revoke, OPML import, Escape/backdrop dismissal paths
