## Context

See proposal.md — Why. Current state that shapes this design:

- The app has a single modal slot: `state.tsx` `ModalKind` union + `App.tsx` `<Show>` wiring; `openModal` *replaces* the current modal, and modal-to-modal chaining (`closeModal(); openModal(...)`) is an established pattern (`SyncJoinModal.tsx:34-35`).
- Three confirmation styles exist: `ConfirmUnsubscribeModal` (modal — the canonical one), a 3-second button-label morph (`SettingsDrawer` regenerate), and native `confirm()` (`SettingsDrawer` OPML import).
- Pairing is direction-agnostic: OTP codes are minted per-key and redeemable by any device (`redeemCode` → key), the `/?pair=` deep-link redeems at boot without any modal, and `pairSyncWithKey` (state.tsx:430) already stores the key and runs `triggerFirstTime()` — so the target-half "pair with key" path is pure UI, no new plumbing.
- `lastErrorKind` (push/pull) exists in `sync/status.ts` but is unused by the UI.
- The `device-sync` spec mandates the unified modal, the disable-sync confirm, and paste pairing; only the specs' wording changes here (key-backup prompt intentionally deferred).

## Goals / Non-Goals

**Goals:**
- One confirmation modal component used by every destructive/confirm flow.
- One pairing modal; one "Pair another device" entry point.
- Drawer sync section that leads with status and separates the danger action.
- Spec re-aligned with the implemented system.

**Non-Goals:**
- Key-backup prompt (spec-required, deferred — flagged in proposal).
- PairResult → toast subsystem; code display grouping (`ABCD-EFGH`); Join/Invite protocol changes.
- Changing enable-sync behavior (toggle stays; spec scenario updated to match).

## Decisions

### D1: Payload-driven generic ConfirmModal with `returnTo` chaining

`ModalKind` gains `{ kind: 'confirm'; title: string; message: string; hint?: string; confirmLabel: string; danger?: boolean; onConfirm: () => void | Promise<void>; returnTo?: ModalKind }`. The existing `ConfirmUnsubscribeModal` skeleton (header / body / subtle Cancel + danger action) becomes `ConfirmModal.tsx`; `confirm-unsubscribe` converts to this kind verbatim (no `returnTo` — its origin, the feed editor, is intentionally closed).

Rationale: one component, three callers lose bespoke code, and `returnTo` solves the single-slot problem uniformly — the confirm modal *replaces* the settings drawer/agents modal, and after close the origin reopens (matching the chaining pattern already used by `SyncJoinModal`). `onConfirm` runs the action, then `openModal(returnTo)` when present.

Alternative considered: inline expand-in-row confirm (no modal stack issue, but adds a second pattern and re-introduces per-call confirm UI — rejected for consistency).

**Escape/backdrop edge case**: `App.tsx`'s global Escape handler (line 28) and `Backdrop` click handler (line 222) get one-line additions: when `modal.kind === 'confirm' && modal.returnTo`, close + reopen the origin instead of closing flat. This keeps every dismiss path (Cancel, Escape, backdrop) returning to the origin, not just the Cancel button.

### D2: One `PairDeviceModal` — role-driven single-section modal

The merged modal is mode-driven rather than showing both halves: `PairDeviceModal` derives its initial mode from `ctx.syncKey()` — a device with a key opens in **source mode** (code + QR + copy + expiry), a device without one opens in **receiving mode** (code/key input + Pair + Scan QR). The alternative direction is a secondary link in source mode ("Enter a code from another device instead"), never a parallel choice. This matches RFC 8628's single-instruction pattern and the WhatsApp/Telegram role split, and it resolves the structural flaw that the old two-column modal's receiving half was unreachable from a fresh device (the "Pair another device" row only rendered when sync was enabled).

- `ModalKind` keeps `{ kind: 'pair-device' }`; `sync-join`/`sync-share` removed; both components deleted.
- The disabled Sync section gains a "Join an existing sync" row opening the same modal (it lands in receiving mode) — closing the fresh-device gap.
- Receiving input normalizes per RFC 8628 §6.1: codes accept an optional grouping dash and any letter case (case-folded before redeem); 22-char keys stay case-sensitive and are validated against `KEY_FORMAT_RE`. The source half displays the code grouped (`abcd-efgh`).
- A code is minted only when source mode is active (`onMount` if enabled, or when switching to source mode) — a fresh device in receiving mode never mints, so it cannot burn the OTP rate limit or hit the no-key 401.
- Camera check + `QrScannerOverlay` move from `SyncJoinModal` unchanged; the scan-success path (`closeModal` → `pair-result`) is preserved.
- The `/?pair=` deep-link path (state.tsx:595) is untouched.

### D3: Drawer sync section restructure

Single `SyncSection` rework in `SettingsDrawer.tsx`:

- Fingerprint row deleted (display-only value; copy was a false affordance — no flow accepts a fingerprint). Fingerprint renders as a suffix span on the status line (`Synced 2 min ago · Group XK7B`) in all states.
- Row order: status + Sync now → "Pair another device" [Pair] → "Agent access" [Manage] → danger-separated "Regenerate sync key" [Regenerate].
- Regenerate button no longer morphs; it opens the confirm modal (`title: 'Regenerate sync key'`, message covers "revokes every agent token; other devices must re-pair", `danger: true`, `returnTo` settings, `onConfirm: regenerateSyncKey`). The old `confirmRegen` signal + 3s timer are deleted.
- Toggle-off now opens the same confirm modal with the spec-mandated text; `onConfirm` runs `disableSync()`. (Spec-required behavior that was never implemented.)
- OPML import's native `confirm()` → confirm modal carrying the preview stats line; `onConfirm` runs the existing merge pipeline.
- Dead `style="border-top: 0"` inline styles removed; the danger zone gets a real `.settings .row.danger` rule (border-top + spacing) — the separator the inline styles were vestiges of.
- Enable-failure `<p>` moves outside the flex row; global `.error` rule added next to `.success` (styles.css:1896) and `.add-feed .error`'s hardcoded red unified to `var(--red)` (the palette variable `scanner-error` already uses).

### D4: Agents modal

- Revoke morph (`confirmId`) deleted → confirm modal (`message` names the token fingerprint, `danger`, `returnTo` agents modal, `onConfirm: revokeAgentToken`); the agents modal remounts on return, so the `createResource` token list refetches.
- Single-cell `.sync-grid` → new `.sync-grid--single` modifier (`grid-template-columns: 1fr`) instead of leaving a dead right column.
- Footer copy corrected to match the generated prompt ("read your feeds and propose additions").
- Expiry line moved directly under the code section; countdown clamps to `<1 min` (shared tiny helper with the pairing modal — both previously showed "Expires in 0 min").

## Risks / Trade-offs

- [Return-to-origin adds modal churn: drawer → confirm → drawer re-mounts (brief flash, fingerprint/status recompute)] → Acceptable; same remount behavior as the existing join flow. Reopen only on confirm paths, never on unrelated closes.
- [Generic ConfirmModal payload carries a function in state] → Solid handles functions in state objects fine; the payload is only ever consumed by `ConfirmModal`/`App.tsx` renderers.
- [Removing `sync-join`/`sync-share`/`confirm-unsubscribe` kinds could break hidden references] → Grepped: only `SettingsDrawer` + `App.tsx` reference them; typecheck will catch stragglers.
- [Fingerprint suffix widens the status row on error states] → It's a small 4-char suffix; label wraps gracefully.
- [Disable-sync confirm changes toggle behavior users know] → Spec-mandated; the two-step flow is exactly what the spec's "Disabling sync requires confirmation" scenario describes.

## Migration Plan

- No server or storage changes; no data migration. Client-only deploy.
- Rollback: revert the single client PR; spec archive is independent.
- Validation: `npm run typecheck`, `npm run lint`, `npm test`; manual pass over drawer + all four modals in `npm run dev`.

## Open Questions

None.
