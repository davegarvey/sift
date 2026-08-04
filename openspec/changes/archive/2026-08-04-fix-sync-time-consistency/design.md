## Context

Sync is a LWW (last-writer-wins) per-field replication protocol between browser IndexedDB and a Workers D1 backend. Timestamps play three roles:

1. **Pull cursors**: `GET /sync/pull?since=X` returns rows with `row_at > X`; the client stores `lastSyncAt = max(since, serverTime)`.
2. **Field LWW**: every field carries `(value, at)`; newer `at` wins on both the server (push PATCH, `server/sync/routes.ts`) and the client (`src/sync/apply.ts` `newer()`), including the tombstone-apply rule `userMutationTime(local) < rf.deleted_at`.
3. **Row order**: `row_at` gates delivery.

Current state has a fundamental scale mismatch: `row_at` and all field stamps are client epoch-ms, while `serverTime` (the pull cursor reference) is a free-running counter starting near 0 (`server/sync/monotonic.ts`). The counter never reaches epoch scale, so the cursor never catches up: every pull is a full dump, forever. Additionally, all stamps are client-wall-clock, so cross-device comparisons (the tombstone decision in particular) are skew-sensitive.

The fix makes the server's time source an epoch-comparable monotonic clock, and introduces a client-side server-clock offset so every comparison happens in one frame.

## Goals / Non-Goals

**Goals:**
- Pulls become incremental: the cursor catches up within one cycle; rows deliver exactly once per change (self-healing, no legacy migration).
- Cross-device clock skew no longer misorders LWW comparisons beyond RTT noise: the tombstone-apply decision and feed-field merges compare in a common frame.
- The row cap no longer counts tombstones.
- Wire compatibility: no field or endpoint removed; old clients interoperate (they keep using their wall-clock stamps and their old counter cursor — which now *works* because serverTime is epoch-scaled; see Risks).

**Non-Goals:**
- Eliminating RTT-level ambiguity: two writes that genuinely race within network RTT remain LWW-ambiguous (arrival order decides at the server via `row_at`). Acceptable for a personal reader.
- HLC / per-device logical clocks (complexity not warranted).
- Re-ordering already-stored rows (migration) — unnecessary, the cursor self-heals.

## Decisions

### D1: The server time source becomes a monotonic wall clock

`server/sync/monotonic.ts` — both functions must be **single atomic statements** (a two-statement read-modify-write can interleave between concurrent pushes and yield equal `batchT` values, silently losing delivery):

```sql
-- nextMonotonicTime: strictly increasing, wall-anchored
UPDATE counters SET value = CASE WHEN value + 1 > ? THEN value + 1 ELSE ? END
WHERE name = 'server_time' RETURNING value
-- binds: [wall, wall]

-- currentMonotonicTime (read path): persists the wall bump so a later batch
-- cannot stamp below a reported serverTime, then returns the value
UPDATE counters SET value = CASE WHEN ? > value THEN ? ELSE value END
WHERE name = 'server_time' RETURNING value
-- binds: [wall, wall]
```

- `CASE WHEN value + 1 > ? THEN value + 1 ELSE ? END` is `max(value + 1, wall)` (SQLite does have scalar `max()`, but the dev D1 shim parses the CASE/arithmetic forms — see below).
- **Why change the counter at all?** (a) the cursor/`row_at` scale mismatch is unfixable while `serverTime` is a ~10³ counter and `row_at` is epoch-scale — one of them must move; moving `serverTime` to epoch scale fixes every existing row automatically (legacy `row_at` ≈ epoch push times are directly comparable), whereas moving `row_at` to counter scale would orphan legacy rows; (b) the client offset (D3) needs a server time comparable with `Date.now()`.
- **Dev shim:** extend `server/sync/local-d1.ts` with a special case for the counters table's `value = CASE WHEN value + 1 > ? ...` form (compute `max(current + 1, param)`); the shim's generic `_applyCase` would otherwise mis-write the param into `value`. The shim's `_select` does not aggregate `COUNT(*)`, so row-cap assertions belong in the miniflare D1 tests, not the shim tests.

### D2: `row_at` is stamped with the server batch time

`batchT = nextMonotonicTime(db)` is called **before building any statements** (the current code computes it at the end of the handler and discards it via `void maxAt` — too late to bind). Every row touched by the batch — target feed rows, flag rows, **and the D5 sibling UPDATEs** (whose `row_at` CASE must bind `batchT`, not the client delete stamp: a skewed client stamp there would put a sibling row's `row_at` below another device's cursor and the tombstone would be silently missed forever) — gets `row_at = batchT`, guarded by `? > COALESCE(row_at, 0)` so a future-dated legacy row is never regressed:

```sql
UPDATE feeds SET row_at = ? WHERE sync_key = ? AND feed_id = ? AND ? > COALESCE(row_at, 0)  -- bind batchT
```

- `maxAt` remains the per-field stamp authority (`field_at` columns unchanged).
- **Self-healing cursor analysis (no migration):** devices that pulled under the old counter have `lastSyncAt ≈ 10³`; after deploy, `since ≈ 10³` matches every row (`row_at` ≈ epoch) → one full pull → cursor = `serverTime` (≈ epoch) → incremental forever. Devices that never pulled (`since = 0`) are unaffected.
- **Same-millisecond delivery guarantee:** `batchT = max(value + 1, wall)` is strictly greater than any previously *persisted* `serverTime` except when a push and a pull-persist land in the same millisecond. The pull query uses `row_at >= since` (instead of `>`), so a row stamped at exactly the cursor value is delivered on the next pull and the cursor then advances past it — the same-ms hole heals, and delivery stays exactly-once (rows with `row_at` strictly below the cursor are never re-returned; rows equal to the cursor were never delivered under that cursor).

### D3: Client server-clock offset normalization

Each device maintains a single meta value `sync_server_offset`, measured on **every** successful pull — including the empty-payload path — as `serverTime - Date.now()` at response receipt, and applied to **the same pull's** incoming stamps (the first pull must not assume offset 0; `serverTime` arrives with the response, so the offset is measurable before `applyRemoteState`). Toggle-off clears it with the other sync state.

- **Outgoing stamps** (`src/sync/push.ts` `chunkToBody`): every emitted `at` — feed-upsert `folderAt/titleAt/feedUrl.at/htmlUrl.at/tagsAt/deletedAt`, feed-delete `feedUrl.at` + `at`, flag `readAt/starredAt` — becomes `at + offset` (server frame). The dirty queue keeps local-frame stamps; conversion happens once at the wire boundary. Offset 0 when unset (only possible for pushes before the first pull).
- **Incoming stamps** (`src/sync/apply.ts`): every remote numeric stamp — `feed_url_at`, `folder_at`, `title_at`, `html_url_at`, `tags_at`, `deleted_at`, `row_at` — is converted to the local frame (`stamp - offset`) in one top-of-function pass before any comparison (the `newer()` calls, the tombstone-apply rule `userMutationTime(local) < rf.deleted_at`, the `lastFetched: Math.max(...)` merge) and before storing merged per-field timestamps. Flag stamps (`read_at`/`starred_at`) need no incoming conversion: flag apply always takes the remote value and `ItemFlag` stores no timestamps — they are outgoing-only.
- **Why a single shared offset instead of per-pull lambdas?** Simple, idempotent, drift between pulls ≈ real clock drift (ms).
- **Sign convention (must be tested):** `offset = serverTime - Date.now()` at pull receipt. `serverFrame(localT) = localT + offset`. `localFrame(serverT) = serverT - offset`.

### D4: Row cap excludes tombstones

`routes.ts` feed-count query gains `AND deleted = 0`. Tombstones are GC'd by the 30-day cron, so they must not crowd out live subscriptions.

## Risks / Trade-offs

- **[Old clients with skewed clocks keep pushing raw wall stamps]** → the server compares a server-frame stamp against an old client's raw stamp — misorder within the old client's skew, same as today. → Mitigation: bounded to pre-upgrade clients; server-side `row_at` is now arrival-ordered so delivery order is still sane; old clients' cursor (`~10³`) also self-heals (D2). Documented.
- **[Server wall clock jumps forward]** (infra migration sets clock ahead) → `max(wall, value+1)` cannot heal a forward jump; `serverTime` jumps, cursors jump, offsets jump. → Mitigation: same exposure as any wall-clock system; Cloudflare Workers clocks are NTP-corrected; a forward jump manifests as one full re-pull (rows with newer `row_at`), which is harmless and self-limiting (cursor catches up). Documented.
- **[RTT-level races remain LWW-ambiguous]** → two devices editing the same field within network RTT can still misorder. → Mitigation: arrival-order `row_at` makes delivery deterministic; field value LWW within RTT is inherently unsolvable without a server arbiter; documented as acceptable.
- **[Same-millisecond push/pull interleave]** → a push whose `batchT` equals the `serverTime` a pull just reported would be skipped by a strict `>` cursor. → Mitigation: the pull query uses `row_at >= since` (D2), so the row is delivered on the device's next pull and the cursor advances past it; delivery remains exactly-once.
- **[Offset estimation noise on the tombstone decision]** → a skewed clock now mis-decides only within RTT+tens of ms instead of seconds. The documented skew limitation shrinks to RTT noise. Residual accepted.

## Migration Plan

1. Server deploy (monotonic wall clock, `row_at = batchT` incl. sibling UPDATEs, `row_at >= since` pull, cap fix). Safe with old clients: cursors self-heal; row_at semantics change only affects delivery ordering.
2. Client release (offset plumbing) — can ship with or after the server.
3. Rollback: revert either side independently; wire format unchanged. A client with offset 0 behaves like today.
4. No data migration; IDB schema unchanged (new meta key).

## Open Questions

- Resolved in red-team review: `nextMonotonicTime`/`currentMonotonicTime` are single atomic statements (D1); `batchT` is computed before statement building (D2); the offset is measured from the same pull's `serverTime` before apply (D3); the sibling UPDATEs bind `batchT` (D2); the spec archive order must be `fix-feed-deletion-sync` → `fix-sync-time-consistency` (see tasks).
