## Context

Sync is a LWW (last-writer-wins) per-field replication protocol between browser IndexedDB and a Workers D1 backend. Feeds live on both sides; deletions are expressed as server-side tombstones (`deleted=1, deleted_at=T`, `row_at=T`) that survive 30 days before the cron purges them (`server/sync/cron.ts:23`).

Three design flaws currently defeat deletions and several other field changes:

1. **Authority confusion.** The client's tombstone-apply rule and several feed-field merges use `lastFetched` as the "local authority" timestamp (`src/sync/apply.ts:94,97,105,108,123`). `lastFetched` is bumped by the background scheduler on *every* fetch (`src/feeds/scheduler.ts:97,105,135`), including 304 not-modified and error paths. A fetch is a read-only operation; using it as authority means any device that fetched a feed after a deletion (or rename, tag edit) on another device rejects the remote change. Because the scheduler keeps bumping `lastFetched`, the rejection persists indefinitely.

2. **Cursor/row_at scale mismatch (pre-existing, affects the whole sync model).** `row_at` is stamped from client epoch timestamps (`server/sync/routes.ts:426-430`, built from `f.*.at`), while the pull cursor (`lastSyncAt`) is the server monotonic counter — an integer starting near 0 (`server/sync/monotonic.ts:15-29`, `routes.ts:548`; the client stores `max(since, serverTime)` in `src/sync/merge.ts:107,140-146`). Epoch-ms `row_at` (~1.75e12) is always greater than the counter cursor, so `WHERE row_at > since` matches **every row on every pull**, forever. Tombstones are therefore re-delivered on every pull, and every pull is O(all data) — up to 10k feeds / 1M flags, against a 15s client timeout (`src/sync/client.ts:21`). The `batchT` value computed at `routes.ts:502-508` is discarded (`void maxAt`), so the fix is not merely "compute it"; legacy rows carry epoch-scale `row_at` and would need re-stamping. This change does NOT fix the mismatch (see Non-Goals) but the narrative must not claim "delivered exactly once" — deliveries are perpetual, and the fix's correctness must not depend on delivery counts.

3. **Tombstone resurrection and per-row deletion.** Every client feed-upsert unconditionally stamps `deleted: {value: 0, at: now}` (`src/sync/push.ts:44,57`; all `enqueueFeed` callers pass `deleted: 0`), and the server clears any tombstone on *any* push for that `feed_id` (`server/sync/routes.ts:354-360`). A metadata edit (title/tags) on the surviving device therefore lifts the tombstone and re-delivers the feed to the deleting device. Separately, the server primary key is `(sync_key, feed_id)` with client-generated UUIDs (`server/sync/schema.ts:7-24`); two devices can hold different `feed_id`s for the same URL (pre-pairing subscribes; re-subscribes via `subscribeFeed`'s `crypto.randomUUID()` at `src/feeds/service.ts:17`). A delete tombstones only the targeted row, and the sibling live row re-delivers the feed on the next pull.

## Goals / Non-Goals

**Goals:**
- Deleting a feed on one device removes it (and its items) from all devices that pull within the tombstone window — including when devices hold different `feed_id`s for the same URL.
- Feed renames and tag edits propagate between devices.
- Metadata edits on a device that kept a feed must not resurrect it on the device that deleted it.
- Re-subscribing to a deleted feed preserves feed identity (and therefore items/read state) on other devices.
- Deterministic, documented conflict resolution for the delete-vs-touch race.

**Non-Goals:**
- Fixing the cursor/`row_at` scale mismatch (every-pull-full-dump). It is pre-existing, requires a legacy-row migration (mixed epoch/counter scales), and is correctness-neutral for this change since the new tombstone-apply rule is idempotent under re-delivery. Tracked as a follow-up change.
- Clock-skew hardening of field-level LWW (all field stamps are client `Date.now()`; `deleted_at` included).
- Cross-device read-state convergence after a re-subscribe in the historical duplicate-row case (flags are keyed by feed UUID; see Risks).
- Tombstone GC window changes (30 days stays).

## Decisions

### D1: Local user-mutation timestamp `Feed.modifiedAt`

Add `modifiedAt?: number | null` to `Feed` (`src/db/types.ts`). Semantics: epoch ms of the last *user-initiated* mutation of this feed on this device. Set in `subscribeFeed`, `updateFeedMeta`, and `changeFeedUrl`; never set by `scheduler.ts` (its `upsertFeed({...feed, ...})` spread preserves the field naturally). The `folder` field is `@deprecated` and has no write path (`src/db/types.ts:19-20`); when it is re-enabled, its mutations go through the same service functions and bump `modifiedAt` automatically.

- **Why not reuse `max(urlAt, titleAt, tagsAt)`?** There is no `folderAt`, and a single field documents intent uniformly. Also `htmlUrl` updates flow from fetches as well as user actions, so per-field picks are ambiguous.
- **Why local-only (not synced)?** It answers one question: "has *this device's user* deliberately touched this feed since time X?" That is inherently local. Syncing it would just be another LWW field fighting the server state.
- **IDB impact:** none — IndexedDB is schemaless; absent field reads as `null`.
- **Preservation on merge:** `applyRemoteState` copies `local.modifiedAt` onto the merged record (`modifiedAt: local?.modifiedAt ?? null`), mirroring how `lastFetched` is already carried through.
- **Legacy records (pre-upgrade, no `modifiedAt`):** the tombstone-apply rule reads `modifiedAt ?? max(urlAt, titleAt, tagsAt) ?? 0` — a read-time fallback so that a feed the user genuinely edited before the upgrade is not silently deleted on the first post-upgrade pull. Records with no touches at all read as `0` and the tombstone applies, which is the correct default.

### D2: Tombstone-apply rule — user-mutation time replaces `lastFetched`

In `applyRemoteState`, a remote row with `deleted=1` and `deleted_at=T` SHALL trigger `unsubscribeFeed(feed_id)` iff the local feed exists AND `(local.modifiedAt ?? 0) < T`. The current rule (`apply.ts:123`) compares against `local.lastFetched`; the no-URL branch (`apply.ts:97`) gets the same change.

Rationale: the only legitimate reason to keep a feed locally after a remote deletion is that the user re-touched it (re-subscribed, renamed, re-tagged) *after* the deletion. Background fetches are not legitimate authority. This matches the original design intent (add-device-sync/design.md:386 — "the local may have re-fetched or re-subscribed") while fixing the flaw that an automatic re-fetch counted as authority.

Resulting conflict matrix for feed X deleted on A at time T:

| B's state at tombstone delivery | Result |
|---|---|
| B never had X | no-op |
| B has X, `modifiedAt < T` (no user touch since delete) | X deleted on B |
| B has X, `modifiedAt > T` (user touched X after delete) | X kept on B; server tombstone stays; documented divergence |

The last row is the documented LWW outcome: the feed lives on B (whose user touched it last) and stays deleted on A. B's metadata pushes do not revive it server-side (D3), so A remains deleted. B's next pull re-delivers the tombstone and reaches the same conclusion (idempotent under re-delivery).

### D3: `deleted`-stamp discipline + tombstone-clear gate on the `deleted` field

Two coordinated changes:

1. **Client** (`src/sync/queue.ts`, `src/sync/push.ts`, `src/feeds/service.ts`): `feed-upsert` dirty entries get nullable `deleted?: 0 | 1` / `deletedAt?: number`. `chunkToBody` omits the `deleted` field from the wire payload when null. Only `subscribeFeed` (explicit subscribe: `deleted: 0, deletedAt: now`) and `enqueueFeedDelete` (`deleted: 1`) stamp it. `updateFeedMeta` and `changeFeedUrl` stop stamping it. Note: `entryAt` (`queue.ts:58`) must coalesce the now-nullable `deletedAt` with `?? 0` or `npm run typecheck` fails.
2. **Server** (`server/sync/routes.ts:354-360`): the tombstone-clear step runs only when the push payload includes the `deleted` field **with `value: 0`** (explicit subscribe intent). Metadata-only pushes (no `deleted`) leave a tombstone untouched; a `deleted: {value: 1}` push does NOT run the clear — the per-field PATCH alone is LWW-correct on both live and tombstoned rows, and running the clear first would destroy a newer tombstone's `deleted_at` (a slow-clock device's older delete stamp would then re-stamp over a newer one).

**Why gate on `deleted` rather than on `feedUrl`?** A red-team review established that `feedUrl` is *not* a re-subscribe-only signal: `updateFeedMeta` and `changeFeedUrl` unconditionally include `feedUrl` in their pushes (`service.ts:71,105`). Gating on `feedUrl` would clear the tombstone on every metadata push and resurrect the feed on the deleting device — the exact failure this change exists to prevent. Gating on `deleted: {value: 0}` is exact for new clients. **Stale-client window:** an older client that still stamps `deleted: 0` on metadata pushes can still resurrect a tombstone; the window is bounded to one release and self-heals on client upgrade (documented in Risks).

**Intent asymmetry (documented, deliberate):** the `deleted: {value: 0}` clear is *intent-based* (unconditional — it clears whatever tombstone exists), while `deleted: {value: 1}` is *LWW-based* (stamp-gated, never clears). A slow-clock subscribe can therefore replace a newer tombstone with a live row, while a slow-clock delete cannot regress a newer tombstone. This is intentional: subscribe is a positive user intent that must win over a deletion it may never have seen; delete is negative intent and loses ties. The asymmetry should not be "fixed" into symmetric LWW without a protocol change.

### D4: Feed-field merge authority

Replace the `local?.lastFetched ?? null` fallbacks in `apply.ts:94,105,108` (feed_url/title/folder `newer()` calls) with `local?.modifiedAt`. Per-field timestamps (`urlAt`, `titleAt`, `tagsAt`, `htmlUrlAt`) remain the primary local comparator when set; `modifiedAt` becomes the baseline when the local per-field timestamp is absent. This fixes rename/tag propagation, which shares the authority bug.

### D5: Delete extends to every row sharing the feed's URL

When `/sync/push` applies a `deleted: {value: 1}` stamp to a feed, the server SHALL also apply the same stamp to every other row with the same `feed_url` under that sync key. New clients carry the URL on the delete payload itself (D7); the handler runs a **pre-pass** at batch start that prefers the payload URL and falls back to a DB lookup for URL-less deletes (legacy clients): collect all `feed_id`s with `deleted: {value: 1}` in the batch, then a single `SELECT feed_id, feed_url FROM feeds WHERE sync_key = ? AND feed_id IN (...)` resolves the unknown ones. The results feed both D5's sibling UPDATEs and D6's in-batch map (below), so no post-pass DB round-trips are needed. **The implementation SHALL filter the pre-pass results to the batch's delete feed_ids in JS** — the dev-mode D1 shim (`server/sync/local-d1.ts:433`) does not parse `IN (...)` and returns all rows; filtering in JS keeps dev and production behavior identical (extra rows are never used). If a resolved URL is NULL, the sibling UPDATE for that URL is skipped.

For each affected URL, append **one** sibling UPDATE (deduped per URL) after all per-feed statements. The URL used for each delete SHALL be the **LWW winner** between the payload URL and the stored row's URL: `payload.at > row.feed_url_at ? payload.url : row.feed_url` (ghost rows have no stored row → payload URL; legacy URL-less deletes → stored row URL only). This is required so a delete that races a remote rename still tombstones the rows under the URL that the per-field PATCH left on the row (the PATCH itself picks the same winner), rather than stale-payload rows escaping. When a batch contains multiple deletes for the same URL, the sibling UPDATE uses the **max** delete stamp across them. The SQL MUST use the forms the dev shim parses (`server/sync/local-d1.ts:441-459`, `262-271`): a `THEN ?` bound to the literal `1` (not `THEN 1` — the shim treats the THEN value as a bind param and would write the timestamp into `deleted`), and `row_at = CASE WHEN ? > row_at THEN ? ELSE row_at END` (not `MAX(row_at, ?)` — the shim's MAX branch only matches the `COALESCE` form and would zero `row_at`). The column order `deleted, deleted_at, row_at` is load-bearing for the shim (it pairs CASE fields positionally) — pin it in a code comment.

```sql
UPDATE feeds SET
  deleted    = CASE WHEN deleted_at IS NULL OR ? > deleted_at THEN ? ELSE deleted END,
  deleted_at = CASE WHEN deleted_at IS NULL OR ? > deleted_at THEN ? ELSE deleted_at END,
  row_at     = CASE WHEN ? > row_at THEN ? ELSE row_at END
WHERE sync_key = ? AND feed_url = ? AND feed_id != ?
-- binds: [deleteAt, 1, deleteAt, deleteAt, deleteAt, deleteAt, syncKey, url, feedId]
```

The per-row LWW CASE keeps an older sibling's fresher state (e.g., a sibling tombstoned later by another device). When a batch contains multiple deletes for the same URL, the sibling UPDATE uses the **max** delete stamp across them. The URL comes from the payload or a server row and is bound as a parameter — no injection surface.

Rationale: the server PK is `(sync_key, feed_id)` and devices can legitimately hold different UUIDs for one URL (pre-pairing double-subscribe, re-subscribe identity divergence). Without this, the sibling live row re-delivers the feed on the next pull and the deletion never sticks. This is the minimal server-side fix; a fuller per-URL row-dedupe is out of scope.

**Dev-mode note:** `npm run dev` exercises sync through `local-d1.ts` (the D1 shim), so every SQL statement added by this change must be shim-parseable (real SQLite correctness is covered by the D1 integration tests). The shim ignores `LIMIT` (D6's `LIMIT 1` degrades to taking the first sorted row — equivalent), so the D6 SELECT needs no shim changes.

### D6: Subscribe revives a tombstoned row by URL (re-subscribe identity)

When `/sync/push` receives a feed payload with `deleted: {value: 0}` AND `feedUrl`, and a tombstoned row (`deleted=1`) exists under that URL, the server SHALL revive the oldest such row under its existing `feed_id` and apply the PATCH to it, instead of inserting the new `feed_id` from the payload. Implementation: `SELECT feed_id FROM feeds WHERE sync_key = ? AND feed_url = ? AND deleted = 1 ORDER BY row_at ASC LIMIT 1`; if found, bind the revived `feed_id` to **all** of the payload's statements (suppress the `INSERT OR IGNORE` under the payload's UUID — otherwise a ghost row with `row_at=0` is created: never delivered on pulls, but it counts against the row cap and a later metadata push can revive it into a live duplicate).

**Same-batch coordination (must-fix):** the D1 batch is built in a pre-pass, so a tombstone created *earlier in the same batch* is invisible to the D6 SELECT. The builder SHALL maintain an in-batch map `url → tombstone_feed_id`, populated from the D5 pre-pass (URLs of `deleted: {value: 1}` payloads in this batch); a later subscribe (`deleted: 0` + `feedUrl`) for a URL in that map routes to that `feed_id` without consulting the DB. The revive policy is **oldest wins**, consistent across both paths: the in-batch map is **first-wins** (the first delete's `feed_id` for a URL — the row devices have held longest), matching the DB path's `ORDER BY row_at ASC LIMIT 1`. This covers the common churn flow "unsubscribe then immediately re-subscribe the same URL" landing in one debounced flush. Both statement orders (delete-then-subscribe, subscribe-then-delete) need D1 tests — note the same-feed pair is impossible (D7 coalesces it), so the subscribe-then-delete test uses two different feed_ids for one URL.

Rationale: without it, a re-subscribe (`subscribeFeed` always generates a new UUID) leaves a tombstone+live pair for one URL; the pull-side dedupe-by-URL (`apply.ts:84-90`) then applies the tombstone to the surviving device's copy, deleting its items, while flags — keyed by feed UUID in item ids (`push.ts:63`, `apply.ts:139`) — are orphaned. Reviving the original row keeps identity stable across delete→re-subscribe, preserving items and read state on other devices. Local identity reconciliation happens through the existing dedupe-by-URL on pull (`apply.ts:84-90` rewrites the server `feed_id` to the local feed's id when URLs match).

Interaction with D5: a delete tombstones all URL rows; a re-subscribe revives the oldest tombstoned row for that URL; siblings stay tombstoned (no-op on pulls).

**Row-cap projection:** because D6 suppresses the INSERT, the pre-batch row-count projection (`routes.ts:278-286`, `count + feeds.length`) can false-413 a legitimate revive push at the cap boundary. The projection SHALL subtract feeds whose INSERT is suppressed by D6 (or count actual inserts).

### D7: Client queue ordering — delete coalesces pending upserts, delete carries the URL

Two client changes to the delete path:

1. `enqueueFeedDelete(feedId, at)` SHALL remove any pending `feed-upsert` entries for the same `feedId` before appending the delete. Without this, a queued-but-unpushed metadata edit followed by a delete sends both entries; the delete's newer stamp wins on the server, but an equal-ms or clock-jump tie could leave `deleted: 0` and resurrect the feed.
2. The `feed-delete` dirty entry and its wire payload SHALL carry `feedUrl` (the feed's current URL at delete time, stamped with the delete time). Without it, a delete of a feed whose `feed_id` is unknown server-side (subscribe-then-delete churn coalesced by change 1, or offline churn) resolves no URL on the server: the sibling rows for that URL survive and re-deliver the feed on the next pull — resurrecting it on the device that deleted it. The server prefers the payload URL and uses the DB pre-pass only as a fallback for legacy URL-less deletes.

### D8: Scheduler must not stamp user-authority fields

`scheduler.ts:134` currently writes `urlAt: feed.urlAt ?? Date.now()` on every successful fetch — for legacy records with `urlAt == null` this stamps a **fetch** timestamp into a field the tombstone-apply fallback reads as user-mutation time (`max(urlAt, titleAt, tagsAt)`), keeping the "background fetch counts as authority" bug alive for the oldest records. Remove the stamp; URL edits via `changeFeedUrl` remain the only writer of `urlAt`.

## Risks / Trade-offs

- **[Offline > 30 days misses deletions]** → Mitigation: documented known limitation, unchanged by this work; the 30-day tombstone window bounds it. This is the only remaining delivery gap. Variant: a legacy (URL-less) delete of a row already purged by the cron cannot resolve a URL server-side, so URL siblings survive even for new-client devices; new clients never hit this (they always carry the URL) — the cause is always a legacy client, the victims may be any device. Documented, no cheap server mitigation (the URL is absent).
- **[Clock skew between devices]** → A's `deleted_at` and B's `modifiedAt` are client-clock values; a slow B clock can convert "user touched after delete" into "feed deleted on B" — the one decision this change aims to make deterministic. → Mitigation: documented; a 2s-skew failure requires B's user to have touched the feed within 2s of A's delete. Not worsened by this change.
- **[Delete-vs-touch conflict resolves to divergence]** → A deletes; B re-touches afterwards → feed survives on B, stays deleted on A; a later tombstone GC purge (30 days) plus a subsequent B metadata edit can re-INSERT the feed and resurrect it on A. → Mitigation: documented LWW semantics; the corner requires B to edit the feed again after the purge window. Accepted.
- **[Stale clients resurrect tombstones]** → an old client stamps `deleted: 0` on metadata pushes, so the D3 gate passes. → Mitigation: bounded to one release (old clients apply deletions less aggressively — only when `lastFetched < deleted_at` — but the resurrection risk is real during the window); self-heals on client upgrade.
- **[Flags keyed by feed UUID]** → after a re-subscribe, read state from *before* the delete may not converge across devices if rows diverged historically. → Mitigation: D6 prevents new divergence by preserving identity; legacy divergence is documented, not migrated.
- **[Every pull returns all rows (cursor/row_at mismatch)]** → re-delivery makes tombstone application idempotent (safe) but keeps pulls O(all data) with a 15s client timeout. → Mitigation: deferred follow-up (row_at from the monotonic counter + legacy-row re-stamp). Correctness of this change does not depend on it.
- **[Tombstone/duplicate accumulation vs the 10k feed row cap]** → delete→re-subscribe churn adds rows; the cap counts tombstones (`routes.ts:279-284`). → Mitigation: D6 reuses tombstoned rows for re-subscribes; D5 extends rather than creates. Residual churn (URL changes) is minor at personal-reader scale; excluding tombstones from the cap is a candidate follow-up.

## Migration Plan

1. Server changes (D3 gate, D5, D6) deploy first — safe with old clients: they only *prevent* resurrection and extend/revive tombstones more correctly. The stale-client window is one release.
2. Client changes ship together (single release): type field, service bumps, apply rule, push discipline, queue coalescing.
3. Rollback: revert the client change; server gating is independently reversible. Wire schema is unchanged (`deleted` stays optional in `FeedPayload`), so old and new clients interoperate.
4. No data migration; IDB schema version unchanged.

## Open Questions

- D5's LWW CASE: should a sibling row with a *newer* `deleted_at` from another device be left untouched (CASE) — yes per LWW — but confirm the sibling's `row_at` bump does not re-deliver the older row content to a device that already applied the sibling's tombstone. Expected: harmless (tombstone apply is idempotent).
- Whether the first-time-setup `pushLocalDiff` should keep stamping `deleted: 0` on fresh pushes (it does today; harmless since those feeds are absent server-side — tombstoned URLs are skipped via `serverFeedUrls` — but revisit for consistency).
- Whether the deferred cursor/row_at fix should be its own change proposal before or alongside archiving this one (it affects pull performance for all sync users).

Resolved during red-team review: the mixed delete+subscribe batch question is now a design decision in D6 (in-batch URL coordination), the tombstone-clear gate is `deleted.value === 0` (D3), and D5 placement/scope is pinned in D5.
