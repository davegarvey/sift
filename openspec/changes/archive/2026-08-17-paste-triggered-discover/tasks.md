## 1. Remove auto-clipboard and add paste-triggered discover

- [x] 1.1 Remove `navigator.clipboard.readText()` call and `looksLikeUrl` helper from `AddFeedModal.tsx`
- [x] 1.2 Change `onMount` to synchronous — only focus the input via `requestAnimationFrame`
- [x] 1.3 Add `onPaste` handler that defers `discover()` via `setTimeout(0)` so `url()` signal updates first
- [x] 1.4 Run `npm run typecheck` and `npm run lint` — zero errors
