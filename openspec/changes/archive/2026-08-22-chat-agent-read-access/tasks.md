## 1. Server: code-authenticated pull

- [x] 1.1 Implement `authOrCode` middleware in `server/sync/auth.ts`: valid `X-Sync-Key` → existing principal; else `?code=` present → `typeof` guard, format check, brute-force guards, look up `pairing_codes` (kind `agent`, unexpired), resolve to a read-only `{ kind: 'code' }` principal; expired/unknown/wrong-kind/malformed → 404; no header and no code → 401
- [x] 1.2 Mount `authOrCode` on `/sync/pull` only (routes.ts:257); `/sync/push` keeps `requirePrincipal`
- [x] 1.3 In-memory brute-force guards (per-isolate windowed counters, no D1 writes): per-IP `60/min`, per-(IP, code) `10/min`, applied before any code lookup; 429 + `Retry-After` on excess
- [x] 1.4 Do NOT delete the code row on code-authenticated pulls (multi-use); keep lazy expiry cleanup
- [x] 1.5 Set `Cache-Control: no-store` on every pull response (header- and code-authenticated) and on the code-path 404/429 responses

## 2. Server: token rotation cross-check and proxy hardening

- [x] 2.1 Rotation kill-switch: `POST /sync/rotate` (old key in header, new key in body) marks the old key's `users` row `rotated_at` (migration `0004_sync.sql`); master-key and agent-token auth reject rotated rows (401); `/sync/register` refuses rotated keys (403); the client's 401-auto-register path is removed and registration is explicit (`runFirstTimeSetup` registers before the first pull)
- [x] 2.2 `getUpstreamUrl` (`server/fetch.ts`) denies loopback, private, link-local, and metadata targets by literal host, IPv6 form, and resolved A/AAAA records (DoH, fail closed); refused targets fail before any upstream request
- [x] 2.3 Fix AGENTS.md violation at `server/fetch.ts:13`: drop the raw URL value from the parse-failure log

## 3. Client: intent URL handling

- [x] 3.1 Extend `ModalKind` in `src/state.tsx` to `{ kind: 'add-feed'; url?: string }`
- [x] 3.2 Add boot handler in `src/state.tsx` next to the `?pair=` block: parse `intent=add&url=` (pass through raw; missing `url` opens empty modal), `openModal({ kind: 'add-feed', url })`, `history.replaceState` cleanup
- [x] 3.3 Seed the URL input in `src/components/AddFeedModal.tsx` from `ctx.state.modal.url` when the modal is `add-feed`; no auto-discovery; existing `urlError()` gates discovery

## 4. Agents modal: prompt and copy

- [x] 4.1 Rewrite `copyPrompt` in `src/components/AgentsModal.tsx` to the D7 prompt: bullets (read via `GET {origin}/sync/pull?code={code}`, propose adds via intent links), constraints (5-minute expiry, no writes, user-approved adds), openapi.json reference
- [x] 4.2 Update modal intro copy to "chat tool like ChatGPT or Claude, or a coding agent" and confirm button labels read correctly

## 5. Docs

- [x] 5.1 `public/openapi.json`: document the optional `code` query param on the pull operation and the intent URL format
- [x] 5.2 `README.md`: add the hosted-chat flow under AI agents (reads via code, adds via intent links, security notes: read-only, 5-minute expiry, code lives in chat history, rotation orphans all tokens, per-syncKey pull budget is shared with agents); update the credential warning if it implies chat tools can't be used

## 6. Tests

- [x] 6.1 Server tests (`tests/sync-code-pull.test.ts`): pull with valid code returns feeds/flags/serverTime; code survives repeated pulls; expired code → 404 (with lazy row cleanup); unknown code → 404; device-kind code → 404; malformed `code` param → 404; no-store on header and code pulls; per-IP guard → 429 with `Retry-After` (and no rate_limits rows written); per-(IP, code) guard; push with only a code → 401; POST redeem still consumes the code
- [x] 6.2 Rotation tests: token works before rotation; rotate deads the old key (401 pull/push) and the token (401); register refuses the rotated key (403); the new key is a live empty group; rotate rejects malformed/identical keys; tokens cannot rotate
- [x] 6.3 Proxy tests (`tests/proxy-target.test.ts`): loopback / private / link-local / metadata / localhost-suffix targets refused (literal and via stubbed DoH resolution); DoH failure fails closed; public targets still fetched
- [x] 6.4 Client smoke tests (`tests/intent-add.smoke.ts`): `?intent=add&url=` opens the add-feed modal prefilled and cleans the address bar; no fetch fired on load; `?intent=add` without `url` opens empty; non-http(s) value shows the validation error and disables Discover

## 7. Verification

- [x] 7.1 `npm run typecheck && npm run lint && npm test` (237 pass) + `npm run test:smoke` (all pass)
- [ ] 7.2 Manual: mint a code in the Agents modal, paste the prompt into Claude web, confirm it reads feeds and emits an intent link; click the link, confirm prefilled add-feed modal and successful subscribe
