## Context

Sift displays a QR code in the sync settings that encodes a pairing URL (`/?pair=CODE`). Currently there is no way to scan this QR code from within Sift — users must manually type the 8-character code. The QR hint says "Open Sift on your other device and scan" but the scanner doesn't exist.

The existing pairing protocol (issue OTP → redeem code → store sync key → trigger first-time merge) is unchanged. The scanner is a new frontend-only input method that feeds into the existing `redeemCode()` path.

The sync settings UI has grown crowded — code input, Pair button, Scan QR button, code display, QR code, countdown ring, copy button, scanner overlay all in one section. This design extracts the two sync flows ("join" and "share") into separate modals, leaving the settings drawer minimal.

## Goals / Non-Goals

**Goals:**
- Allow a device to scan a sync-pairing QR code using the device camera
- Complete the pairing flow automatically after scanning
- Auto-refresh expired pairing codes, removing the manual Regenerate button
- Replace text countdown with a visual countdown ring
- Fix the shared `busy` signal bug that affects the Pair button
- Extract "join" and "share" flows into dedicated modals for a cleaner settings UI

**Non-Goals:**
- Server-side changes (pairing protocol, rate limits, code generation are unchanged)
- QR code scanning for anything other than sync pairing
- Making Sift a general-purpose QR code reader

## Decisions

### D1. QR decoding library: jsqr
**Decision:** Use `jsqr` (pure JS, dynamically imported).
**Rationale:** Pure JS, no WASM, no dependencies, ~60KB. Dynamically imported so it's not loaded on every settings visit. Alternatives considered: `html5-qrcode` (heavier, opinionated UI), `zxing-wasm` (WASM overhead, larger bundle).

### D2. Two-module architecture: SyncJoinModal + SyncShareModal
**Decision:** The sync flows are extracted into two standalone modals (`SyncJoinModal` and `SyncShareModal`), each rendered as a `ModalKind` in `App.tsx`. The `SyncSection` in SettingsDrawer is reduced to just the enable toggle and two action buttons that call `ctx.openModal()`.

**Rationale:** The sync section had grown complex with inline form, scanner overlay, code display, QR display, and timers. Extracting into dedicated modals isolates state, improves mobile ergonomics (each modal is focused on one task), and keeps the settings drawer manageable.

`SyncJoinModal` owns: code input, Pair button, camera availability check, scanner overlay. `SyncShareModal` owns: code generation, auto-refresh timer, countdown ring, copy button, QR display.

### D3. Camera constraint: `facingMode: { ideal: 'environment' }`
**Decision:** Use `ideal` rather than exact.
**Rationale:** Falls back to any available camera if no rear camera exists (e.g., front-camera-only tablets). QR scanning works with either camera.

### D4. Frame capture: downscaled to ~320×240
**Decision:** The canvas used for frame capture is set to a fixed small resolution regardless of camera input resolution.
**Rationale:** `jsqr` is synchronous — processing full 1920×1080 frames (~2M pixels) every 500ms blocks the UI thread. Downscaling to ~77K pixels per frame reduces decode time from hundreds of ms to <50ms on mid-range devices.

### D5. Origin validation on scanned URL
**Decision:** After `jsqr` decodes a string, validate `new URL(data).origin === window.location.origin` before extracting the `?pair=` parameter.
**Rationale:** Prevents processing QR codes from other origins. Without this check, a QR from a different service could be parsed and its `?pair` parameter attempted against the local sync server.

### D6. Auto-refresh pairing code
**Decision:** After `generateCode()` succeeds, schedule a `setTimeout` for `expiresAt - Date.now()`. On expiry, call `generateCode()` again. No visual notification of refresh.
**Rationale:** Removes the Regenerate button (simpler UI). The code and QR are always valid while the modal is open. The countdown ring provides passive awareness of freshness without noise.

### D7. Visual countdown ring (shared, bottom-right of modal)
**Decision:** A single SVG circle with `stroke-dasharray`/`stroke-dashoffset` animating from full at code generation to empty at expiry. Color changes to red for the last 30 seconds. Updates via 1-second `setInterval`. Positioned at the bottom-right of the modal body (outside both code and QR blocks) since both display the same OTP.
**Rationale:** More glanceable than text. Shared placement avoids duplicating the ring and reflects that a single OTP underlies both displays.

### D8. Separate busy signals
**Decision:** Split the single `busy` signal into `codeBusy` (for code generation) and `pairBusy` (for the Pair button and input field).
**Rationale:** Bug fix. Both operations shared the same `busy` signal, so generating a code would disable the Pair button and change its text to "Pairing…".

### D9. Scanner overlay as inline layer within SyncJoinModal
**Decision:** The `QrScannerOverlay` component is rendered conditionally inside `SyncJoinModal`, not as a standalone `ModalKind`. It uses `position: fixed` at a high z-index to cover the viewport, including its parent modal. Escape key uses `e.stopPropagation()` to close only the scanner, not the join modal.
**Rationale:** The scanner is only relevant within the join flow. Keeping it as an inline overlay avoids adding yet another ModalKind and keeps the state (camera, scan loop) encapsulated within the join modal's lifecycle.

## Risks / Trade-offs

- **[UX] Camera permission prompt blocks interaction** — On first use, the browser permission prompt may confuse users. Mitigation: the Scan QR button text and disabled state (when no camera detected) set expectations before clicking.
- **[Performance] Frame decode loop on slow devices** — While 320×240 downscaling helps, very low-end devices may still stutter. Mitigation: the 500ms interval is a balance between responsiveness and battery; adjustable.
- **[Reliability] `getUserMedia` edge cases** — `NotReadableError` (camera busy), `AbortError` (user dismissed prompt), `NotAllowedError` (denied). Mitigation: comprehensive error handling maps each error type to a specific user-facing message with actionable fallback.
- **[UX] Duplicate state (code + QR) in share modal** — Both the code block and QR display the same OTP, but users may expect to see both. Keeping both (with a single shared ring) balances familiarity with simplicity.
