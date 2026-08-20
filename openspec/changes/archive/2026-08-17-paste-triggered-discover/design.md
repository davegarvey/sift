## Context

The Add Feed modal (`src/components/AddFeedModal.tsx`) currently pre-fills the URL input by calling `navigator.clipboard.readText()` in an async `onMount` callback. This is a best-effort enhancement added to the original `add-core-reader` implementation. The clipboard read is serialized before input focus, creating a race condition where clipboard read can overwrite user typing and delay focus.

This change replaces the proactive clipboard read with a reactive paste-triggered auto-discover: when the user pastes into the input, discovery fires automatically (same as pressing Enter).

## Goals / Non-Goals

**Goals:**
- Remove `navigator.clipboard.readText()` from `onMount`
- Auto-focus the input immediately on mount
- Auto-trigger feed discovery when the user pastes a URL
- Remove the `looksLikeUrl` helper (no longer needed)

**Non-Goals:**
- No change to the discovery logic, error handling, or subscribe flow
- No change to the keyboard-driven (Enter) discover trigger
- No change to the modal UI layout or styling

## Decisions

### D1: Use `onPaste` + `setTimeout(0)` instead of tracking paste programmatically

- **Why**: The `onPaste` event fires before `onInput`, so the `url()` signal hasn't been updated yet when `onPaste` fires. Wrapping `discover()` in `setTimeout(0)` defers it one macrotask, by which point `onInput` has fired and `url()` reflects the pasted value. This avoids needing a separate paste-handler that reads `e.clipboardData`.
- **Alternatives considered**: Reading `e.clipboardData.getData('text')` in `onPaste` and manually setting the URL — more verbose, duplicates the existing `onInput` path. `setTimeout(0)` is simpler and keeps the signal as the single source of truth.

### D2: Keep `requestAnimationFrame` for focus

- **Why**: The existing pattern defers focus one frame so the modal is fully painted. This is unchanged — but now focus happens immediately (no longer blocked by clipboard read), which is the main UX improvement.

### D3: Remove `looksLikeUrl` entirely

- **Why**: It was only used by the clipboard pre-fill guard. With no proactive clipboard read, there's nothing to guard. The input accepts any text; discovery will fail gracefully if it's not a valid URL.

## Risks / Trade-offs

- **Paste without triggering discover**: If the paste event fires but the pasted content is not a URL, discovery will fail and show an error. This is identical to the existing behavior when the user types a non-URL and presses Enter — not a new problem.
- **`setTimeout(0)` timing**: In rare cases (extremely slow renders), `discover()` might fire before `onInput` has updated the signal. Mitigated by the fact that `onInput` is synchronous and fires before the next macrotask.
