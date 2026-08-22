## 1. Server: push protocol cleanup

- [x] 1.1 Remove `at` from push validation — `validateFeedPayload` / `validateFlagPayload` reject any `{ value, at }` wrapper with a descriptive 400 (bare values only)
- [x] 1.2 Stamp every pushed field with `batchT` — replace per-field `at` bindings in the feed/flag PATCH CASE statements with the batch stamp (routes.ts push handler)
- [x] 1.3 Apply the tie-break: `deleted` field PATCH and the URL-scoped sibling tombstone compare with `>=` so a tombstone wins equal stamps
- [x] 1.4 Update the D5/D6 pre-pass (delete URL resolution, in-batch tombstone maps) to operate on `batchT`-derived stamps
- [x] 1.5 Confirm pull (`since`/`serverTime`/`row_at`) semantics are unchanged; add a regression test for cursor continuation across a server-stamped push

## 2. Server: agent tokens

- [x] 2.1 New D1 migration: `tokens` table (token_id, token_hash, sync_key, scope, fingerprint, created_at, last_seen_at, last_seen_minute) + `pairing_codes.kind` column (`'device'` default); mirror both in `server/sync/schema.ts` `ensureSchema`
- [x] 2.2 Implement `POST /sync/tokens` (master-key auth) — mint 8-char code with `kind='agent'`, 5-min TTL, `expiresAt` in ms, rate-limited on a `tokens:mint` scope (20/hr per key)
- [x] 2.3 Implement `POST /sync/tokens/redeem` — one-time exchange of an agent code for a 23-char `t`-prefixed token (≥128-bit random), rate-limited on a separate `tokens:redeem` per-IP scope
- [x] 2.4 Implement `GET /sync/tokens` (master-key auth) — metadata list (token_id, fingerprint, scope, created_at, last_seen_at), never raw tokens
- [x] 2.5 Implement `DELETE /sync/tokens` (master-key auth) — revoke by token_id, immediate
- [x] 2.6 Compute and store the token fingerprint at mint time (SHA-256 → first 20 bits → 4 Crockford chars); add a fixed test vector matching the browser's `fingerprintSyncKey`
- [x] 2.7 Auth middleware: branch on format (22-char → users, `t`-prefixed 23-char → tokens by hash), carry principal type in context, update `last_seen_at` throttled to once per minute
- [x] 2.8 Route allowlist: token principals 401 on everything except `GET /sync/pull` and `POST /sync/push` (explicitly: otp, register, tokens mint/list/delete)

## 3. Server: tests for new surface

- [x] 3.1 Token lifecycle integration tests (D1): mint → redeem → pull/push with token → 401 on otp/register/tokens routes → list → revoke → 401 after revoke
- [x] 3.2 Token format tests: 23-char `t`-prefixed never validates as a sync key; `/sync/register` rejects token-shaped values
- [x] 3.3 Rate-limit tests: mint scope per key, redeem scope per IP, shared pull/push buckets across master + token
- [x] 3.4 Agent code tests: expiry, one-time use, cross-table isolation (device code fails agent redeem and vice versa), cron sweep coverage
- [x] 3.5 Fingerprint test vector: same token → identical fingerprint from server, Settings UI, and CLI implementations

## 4. Browser client

- [x] 4.1 `src/sync/push.ts` — remove offset-based stamping; build bare-value payloads; keep queue dedup/coalescing
- [x] 4.2 `src/sync/client.ts` — push payload types/serialization to bare values
- [x] 4.3 Verify `src/sync/apply.ts` incoming offset conversion is retained (merge frame) and adjust for the new push contract
- [x] 4.4 Convert sync client/queue tests to the bare-value contract (`sync-queue.test.ts` asserts `at` values — rewrite those assertions)
- [x] 4.5 Settings: "Agents" row in `SyncSection` (gated on sync enabled) opening `AgentsModal`

## 5. Settings Agents modal

- [x] 5.1 `AgentsModal` — pair flow: "Pair agent" button → `POST /sync/tokens` → 8-char code + countdown + copy + cancel
- [x] 5.2 Token list: `GET /sync/tokens` → fingerprint, created, last-seen; empty state with pair action
- [x] 5.3 Revoke: confirm step → `DELETE /sync/tokens { token_id }` → list refresh
- [x] 5.4 Error handling: mint/revoke failures surfaced in-modal; rate-limit messaging

## 6. siftctl CLI

- [x] 6.1 Scaffold `packages/siftctl/` (own package.json, `bin: siftctl`, publishable, `siftctl` name if free else `@davegarvey/siftctl`)
- [x] 6.2 Config: `~/.config/siftctl/token` (0600), `SIFTCTL_TOKEN` env precedence, `SIFTCTL_URL` (default hosted)
- [x] 6.3 `pair <code>` — redeem, write token only on success, print confirmation
- [x] 6.4 `status` — capabilities, base URL, token fingerprint (same algorithm as server)
- [x] 6.5 `feeds [--json]` — pull, filter tombstones, URL-dedupe rows
- [x] 6.6 `feed add <url>` — pull-first `feed_id` reuse, else URL as `feed_id`; bare-value push; `feed remove <url> --yes`
- [x] 6.7 `items <url> [--limit N]` — fetch + parse (vendored `@extractus/feed-extractor`), browser-matching guid fallbacks, item IDs (`encodeURIComponent(feedId)::guid`)
- [x] 6.8 `mark read <itemId>` — bare-value flag push
- [x] 6.9 Exit-code contract (0/1/2), stdout data / stderr errors, `--json` purity; "not paired" messaging
- [x] 6.10 CLI unit tests (mock fetch): pair, status, feeds, add/remove, items id derivation, mark read, exit codes

## 7. OpenAPI document

- [x] 7.1 Author `public/openapi.json` — capabilities/register/otp/redeem/pull/push/tokens endpoints, `X-Sync-Key` security scheme, bare-value push schema (no timestamps), `since`/`serverTime` cursor docs, master-key-only endpoints marked
- [x] 7.2 Verify serving: `/openapi.json` served from the Worker (exact-match asset before SPA fallback) and through the vite dev middleware
- [x] 7.3 Validation: served document matches the live API surface (endpoint/method/security smoke test)

## 8. Docs

- [x] 8.1 README: agent setup (siftctl install + pair; OAS/ChatGPT path), credential warnings, revocation instructions, `SIFTCTL_*` env vars, prompt template for agents
- [x] 8.2 Update README sync/privacy sections if the push contract or token surface warrants it
- [x] 8.3 Update openspec specs if implementation diverges from the deltas

## 9. Manual verification

- [x] 9.1 Local D1 dev: pair an agent, run all siftctl commands against local server, verify Settings Agents modal (pair/list/revoke), verify browser pull applies an agent-added feed within a refresh cycle
- [x] 9.2 Verify master-key takeover is blocked: token on `/sync/otp` and `/sync/register` → 401
- [x] 9.3 Verify in-batch subscribe-then-delete leaves no live row (D1 + shim)
- [x] 9.4 Deploy dry-run (`wrangler deploy --dry-run`) with the new migration; confirm `ensureSchema` parity
