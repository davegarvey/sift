## Context

See proposal.md — Why. Current state: sync is a D1-backed, multi-tenant sync protocol (X-Sync-Key bearer auth, per-field LWW merge with client-supplied `at` stamps, monotonic server time, tombstone machinery with in-batch D5/D6 rules). The browser is the only client. Push payloads carry `{value, at}` wrappers; the client maintains a server-clock offset for stamping (`src/sync/push.ts`) and for local merge comparisons (`src/sync/apply.ts`). MCP remains a local-only feature of the Node server; the Worker has no MCP surface. The change makes the sync API consumable by agents: a clean (server-stamped) push protocol, scoped agent tokens, a `siftctl` CLI, an OpenAPI doc, and a Settings agents UI.

## Goals / Non-Goals

**Goals:**
- Server is the only clock: push payloads carry bare values; no client timestamp logic anywhere on the wire
- Agents authenticate with scoped, revocable tokens that can never become the master key (explicit route allowlist)
- `siftctl` as a published npm package usable against hosted prod without cloning the repo
- OpenAPI document served statically at a stable URL for third-party consumers (ChatGPT etc.)
- Settings gains one row + an Agents modal; the browser never holds or displays raw tokens

**Non-Goals:**
- MCP changes (stays local-only)
- Read-only token scope in v1 (schema carries `scope`, v1 mints `rw` only)
- Token TTL/expiry in v1 (revocation is the control; rotation orphans are documented)
- Multi-tenant hardening beyond the existing sync model (rate limits stay per sync key/IP)
- WebSocket/push delivery to browsers — pull-based propagation as today

## Decisions

### D1: Token namespace is disjoint from master keys by construction

Tokens are 23 characters starting with `t` (`t` + 22 chars from the existing alphabet), which fails `KEY_FORMAT_RE` (`/^[A-Za-z0-9_-]{22}$/`, exactly 22 chars). The auth middleware branches on format: 22-char → master-key lookup (users table); `t`-prefixed 23-char → token lookup. Consequences: `/sync/register` can never accept a token (its `isValidSyncKey` check rejects 23-char values), tokens can never be mistaken for users, and lookup order is unambiguous. Alternative considered: same format + dual table lookup — rejected: creates the register-pollution and precedence ambiguity the red team flagged.

### D2: Principal-aware middleware with an explicit allowlist

`requireSyncKey` becomes `requirePrincipal`, carrying `{ syncKey, principal: 'master' | 'token', tokenId? }` in context. Master principals may call everything. Token principals are allowed only on `GET /sync/pull` and `POST /sync/push`; every other route mounted on the middleware (otp, register, tokens mint/list/delete) rejects tokens with 401. The allowlist is implemented as a per-route check on the principal type, not as "everything except X" — the red team's `/sync/otp` → `/sync/redeem` → master-key takeover is the canonical failure of the narrow-denylist approach.

### D3: Agent codes reuse `pairing_codes` with a `kind` column; tokens get their own table

Device pairing codes and agent pairing codes share alphabet, TTL (5 min), and expiry handling. Reusing `pairing_codes` with `kind TEXT NOT NULL DEFAULT 'device'` keeps the existing device redeem flow untouched (`WHERE code = ?` plus `kind` filter) and gives the cron cleanup for free. The `tokens` table:

```
tokens (
  token_id      TEXT PRIMARY KEY,   -- opaque random id (returned in lists)
  token_hash    TEXT NOT NULL,      -- SHA-256 of the token (raw token never stored)
  sync_key      TEXT NOT NULL,
  scope         TEXT NOT NULL DEFAULT 'rw',
  fingerprint   TEXT NOT NULL,      -- 4 Crockford chars (D4)
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER,            -- throttled (D5)
  last_seen_minute INTEGER          -- throttle watermark
)
```

The raw token is never stored: the middleware hashes the presented credential and looks up by hash. Revocation is a row delete (immediate). The schema must also be mirrored in `server/sync/schema.ts`'s `ensureSchema` (the dev/shim path) alongside the D1 migration.

### D4: Fingerprint algorithm pinned to the client scheme

`fingerprintSyncKey` (src/sync/key.ts): SHA-256 of the credential, first 20 bits → 4 uppercase Crockford base32 chars. The server computes the same from the token at mint time (Workers Web Crypto `crypto.subtle.digest` — no new dependency), stores it, and returns it in lists; `siftctl status` computes it locally. A fixed test vector in the sync tests pins all three implementations to identical output.

### D5: `last_seen` throttled

Updating `last_seen_at` on every authenticated request doubles D1 writes per request (rate-limit upsert + last_seen). Throttle: update only when the current minute differs from `last_seen_minute` (one extra write per token per minute, worst case).

### D6: Delete tie-break: tombstone wins on equal stamps

All stamps in a batch are `batchT`, so "same-batch subscribe then delete" previously tied (first-writer wins → live row left behind; the D5 sibling UPDATE excludes the targeted `feed_id`). Fix: the `deleted` field's PATCH comparison uses `>=` instead of `>` (a tombstone wins ties), applied both in the per-field PATCH and the URL-scoped sibling tombstone. Cross-batch stamps are strictly increasing (monotonic counter), so `>=` has no effect outside the in-batch case. The browser's existing coalescing (delete drops pending upserts) remains as a client-side optimization, but the protocol no longer depends on it.

### D7: Server stamping implementation

`/sync/push` drops `at` from validation; the per-field CASE bindings use `batchT` (already minted once per batch at routes.ts:445) for every field, and the D5 pre-pass (URL resolution for deletes) compares `batchT` against stored stamps (always newer). Client side: `src/sync/push.ts` loses the offset-based stamping entirely; `src/sync/apply.ts` keeps the offset conversion for incoming stamps (local merge comparisons remain local-frame). The main spec's "Client server-clock offset normalization" requirement survives in modified form (incoming-only).

### D8: `siftctl` packaging

A `packages/siftctl/` subpackage with its own `package.json` (name `siftctl` or scoped `@davegarvey/siftctl` — `npm view siftctl` is free, prefer unscoped), `bin: { siftctl: "dist/cli.js" }`, publishable independently of the private root app. It vendors two small helpers from the app: `encodeItemId`/`decodeItemId` (src/sync/itemId.ts) and the item-identity fallback rules (src/feeds/parse.ts) — ~60 lines total; `@extractus/feed-extractor` (MIT, already in the app's deps) does the XML parsing. Config: `~/.config/siftctl/token` (0600), env `SIFTCTL_TOKEN` and `SIFTCTL_URL` (default hosted). The root repo also gets a `npm run siftctl` dev script for in-repo use. Alternative considered: repo-local executable only — rejected (the user wants non-cloners to install from npm).

### D9: Rate limits

New scopes: `tokens:mint` per sync key (20/hr, matching otp's class), `tokens:redeem` per IP (10/min, separate from device `redeem` scope so an agent-code attacker can't DoS device pairing from a NAT'd IP). Pull/push buckets stay shared per sync key across all principals (documented in the spec).

### D10: OAS as a hand-maintained static file

`public/openapi.json` → `dist/` → Worker assets (verified: exact-match asset serving precedes the SPA fallback; vite dev middleware passes `/openapi.json` through). Hand-maintained beside `openspec/specs/device-sync/spec.md` — no generation tooling. The doc marks master-key-only endpoints explicitly so third-party consumers know agent tokens can't call them.

### D11: Settings Agents modal

One row in `SyncSection` ("Agents") gated on sync being enabled, opening an `AgentsModal` following the existing modal patterns (ctx.openModal, SyncShare-style code display, ConfirmUnsubscribe-style confirm). Flow: "Pair agent" → `POST /sync/tokens` → show 8-char code + countdown + copy; list from `GET /sync/tokens` (fingerprint, created, last-seen); revoke via `DELETE /sync/tokens { id }` behind confirmation. The browser never sees tokens (mint returns a code; redeem happens elsewhere).

## Risks / Trade-offs

- [Breaking push protocol] All existing sync tests (~30 push sites across `tests/sync-d1.test.ts`, `sync-shim`, `sync-pairing-e2e`, `sync-queue`) need conversion; `sync-queue.test.ts` asserts `at` values that cease to exist → Budget a near-total rewrite of the push-related test cases; the D1 integration tests and the local-D1 shim both need the tie-break coverage.
- [In-batch tie semantics] Any new consumer that pushes two entries for the same field in one batch silently keeps the first → The spec documents the tie rule; the CLI dedupes before pushing; the browser coalesces in the queue.
- [Key rotation orphans tokens] Rotating the sync key strands tokens against orphaned data, unrevocable from the new key → Documented as accepted behavior (spec scenario); revocation is per-key, and rotation is rare.
- [CLI duplicate rows] CLI-created rows keyed by URL could duplicate browser UUID rows on a fresh device → Mitigated by the feed_id-reuse rule (pull-first) and URL dedup in `siftctl feeds` and the browser's apply-time URL reconciliation (src/sync/apply.ts:105-111).
- [ChatGPT-style consumers] Third-party consumers get full `rw` on their token; a leaked token is revoked via Settings → The token is scoped and revocable; the OAS + README warn loudly.
- [Spec scenario-name warts] Legacy-named scenarios ("Push with at=0…", "Legacy client payloads remain valid") keep old names with inverted content — the archive workflow requires name preservation; the requirement text states the contract explicitly.

## Migration Plan

Single coordinated release (the breaking push change ships with the updated browser client — old browsers pushing `at` would 400):
1. D1 migration + `ensureSchema` update; server routes/auth/tokens; tests converted to bare values (D1 + shim)
2. Browser client: `push.ts` stamping removed, `apply.ts` kept, Settings Agents row + modal
3. `packages/siftctl` published; `public/openapi.json` committed; README + prompt template
4. Rollback: revert the release; tokens table + migration are additive and safe to leave; the push change is the only breaking piece and it reverts atomically with the client

## Open Questions

- Token display names: mint could accept an optional agent name (`siftctl pair --name`) stored on the token for friendlier Settings listings — defer, the fingerprint is sufficient for v1.
- Should `GET /sync/tokens` paginate? The per-user token count is expected to be tiny (<10); defer unless the cap becomes real.
