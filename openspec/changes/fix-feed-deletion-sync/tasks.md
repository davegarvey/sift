## 1. Client: user-mutation timestamp

- [x] 1.1 Add `modifiedAt?: number | null` to `Feed` in `src/db/types.ts`
- [x] 1.2 Set `modifiedAt: Date.now()` in `subscribeFeed` (`src/feeds/service.ts`)
- [x] 1.3 Bump `modifiedAt` in `updateFeedMeta` (title/tags) and `changeFeedUrl`
- [x] 1.4 Remove the `urlAt: feed.urlAt ?? Date.now()` stamp from `scheduler.ts` (a fetch time must never land in a user-authority field); add a unit test asserting a simulated fetch leaves both `modifiedAt` and `urlAt` unchanged

## 2. Client: apply rules

- [x] 2.1 In `src/sync/apply.ts`, change the tombstone-apply checks (both the no-URL branch at ~line 97 and the main branch at ~line 123) to compare `(local.modifiedAt ?? max(urlAt, titleAt, tagsAt) ?? 0) < rf.deleted_at` instead of `local.lastFetched`
- [x] 2.2 Replace the `local?.lastFetched ?? null` fallbacks in the feed_url/title/folder `newer()` calls (`apply.ts:94,105,108`) with `local?.modifiedAt`
- [x] 2.3 Preserve `modifiedAt: local?.modifiedAt ?? null` on the merged feed record in `applyRemoteState`
- [x] 2.4 Confirm `unsubscribeFeed` still deletes the feed and its items, and that the tombstone path does not depend on the remote row carrying `feed_url`

## 3. Client: deleted-stamp discipline

- [x] 3.1 Make `deleted`/`deletedAt` nullable in the `feed-upsert` dirty entry (`src/sync/queue.ts`), keeping `feed-delete` as-is; update `entryAt` (`queue.ts:58`) to coalesce the nullable `deletedAt` with `?? 0` (required for typecheck)
- [x] 3.2 Update `chunkToBody` (`src/sync/push.ts`) to omit the `deleted` field from the wire payload when null
- [x] 3.3 Remove `deleted: 0, deletedAt: now` from `updateFeedMeta` and `changeFeedUrl` enqueues; keep it in `subscribeFeed`
- [x] 3.4 `enqueueFeedDelete` drops pending `feed-upsert` entries for the same `feedId` before appending
- [x] 3.5 `feed-delete` entries carry `feedUrl` (feed's URL at delete time); `chunkToBody` emits `feedUrl: { value, at }` on the delete payload; `service.ts:unsubscribeFeed` reads the feed before deleting
- [x] 3.6 Verify `pushLocalDiff` (first-time setup) still stamps `deleted: 0` only for feeds absent server-side; add a comment if intentional

## 4. Server: tombstone gate and URL-scoped tombstones

- [x] 4.1 In `server/sync/routes.ts`, gate the tombstone-clear step (currently unconditional at ~line 354-360) on the presence of the `deleted` field **with `value: 0`**; a `deleted: { value: 1 }` push must NOT run the clear (its PATCH alone is LWW-correct and preserves a newer tombstone's `deleted_at`)
- [x] 4.2 Implement the D5/D6 pre-pass: collect `deleted: 1` feed_ids in the batch, resolve URLs preferring the payload's `feedUrl` with a single `SELECT feed_id, feed_url, feed_url_at ... WHERE sync_key = ? AND feed_id IN (...)` fallback for URL-less deletes; **filter pre-pass results to the batch's delete feed_ids in JS** (the dev D1 shim doesn't parse `IN`); the sibling URL per delete is the LWW winner of payload URL vs stored row URL (ghost rows → payload URL)
- [x] 4.3 Append one sibling UPDATE per unique URL (deduped; max delete stamp across the batch's deletes for that URL) after all per-feed statements, using shim-compatible SQL: `THEN ?` bound to `1`, `row_at = CASE WHEN ? > row_at THEN ? ELSE row_at END`, `WHERE sync_key = ? AND feed_url = ? AND feed_id != ?`; skip URLs resolved to NULL; keep the column order `deleted, deleted_at, row_at` (the dev shim pairs CASE fields positionally) and pin it in a comment
- [x] 4.4 Implement D6: on a payload with `deleted: { value: 0 }` + `feedUrl`, revive the **oldest** tombstoned row for that URL under its existing `feed_id` (in-batch map first — first-wins per URL, consistent with the DB path's `ORDER BY row_at ASC LIMIT 1` — then DB SELECT fallback), binding the revived id to ALL of the payload's statements (suppress the INSERT under the payload's UUID — no ghost rows); DB-resolved URLs route through `assertNoUrlLog`
- [x] 4.5 Adjust the row-cap projection (`routes.ts:278-286`) so feeds whose INSERT is suppressed by D6 do not false-413 a legitimate revive push at the cap boundary
- [x] 4.6 Confirm `assertNoUrlLog` / `assertNoUserDataLog` coverage for the new SELECTs, payload URLs, and URL-batched UPDATEs

## 5. Tests

- [x] 5.1 Update `src/sync/sync-client.test.ts`: replace `lastFetched`-authority assertions with `modifiedAt`-based tombstone expectations (both directions: apply and keep)
- [x] 5.2 Update `src/sync/sync-queue.test.ts`: metadata upserts omit `deleted`; `enqueueFeedDelete` coalesces pending upserts; subscribe/delete still stamp `deleted`; delete carries `feedUrl`
- [x] 5.3 Add an `applyRemoteState` unit test with fixed `modifiedAt`/`deleted_at` values covering the conflict matrix (no local feed / older / newer / equal timestamps) and the legacy fallback (`modifiedAt` absent → `max(urlAt, titleAt, tagsAt)`)
- [x] 5.4 Add D1 integration tests (`sync-d1` pattern): metadata push does not clear a tombstone; delete tombstones all rows sharing the URL; a `deleted: 1` push does not regress a newer tombstone's `deleted_at`; subscribe revives a tombstoned row by URL (no ghost row; row-cap projection at boundary); **mixed delete+subscribe batch in both orders** (subscribe-then-delete uses two different feed_ids for one URL, since the same-feed pair is coalesced by D7); delete of a server-unknown feed_id tombstones URL siblings; delete+metadata same-URL batch; delete after a remote rename tombstones rows under the LWW-winning URL
- [x] 5.5 Add a two-device e2e case (`sync-pairing-e2e` pattern) where the two devices hold **different** `feed_id`s for the same URL (created via raw pushes, since the first-time-setup diff skips URL matches): delete on A must remove the feed on B and stay deleted on A after subsequent pulls
- [x] 5.6 Add an e2e case: A deletes X, B re-subscribes X → B's items and read state survive (identity preserved server-side), and the feed returns on A as a fresh subscription
- [x] 5.7 Run `npm run typecheck`, `npm run lint`, `npm test`; all green

## 6. Spec reconciliation and docs

- [ ] 6.1 Reconcile the live sibling deltas with the new tombstone rules before archiving: (a) `fix-sync-first-pairing` scenarios "Local feed already deleted on the server" and "Local feed whose URL changed on the server after deletion" — qualify with the `modifiedAt` rule; (b) `add-device-sync` scenarios "Remote feed is tombstoned" / "Remote feed is tombstoned but local is fresher" / "Re-subscribe clears server-side tombstone" — mark superseded by this change's delta
- [ ] 6.2 Archive order: archive `add-device-sync` and `fix-sync-first-pairing` BEFORE this change; after syncing, grep `openspec/specs/` for `lastFetched`-authority and "clears the tombstone" residue
- [x] 6.3 Update the Settings sync description / README sync section if it documents tombstone or deletion behavior; search README for "delet", "sync", "tombstone"
- [x] 6.4 Record the deferred follow-ups in design.md or a follow-up change: cursor/`row_at` monotonic mismatch (with legacy-row migration), excluding tombstones from the row cap, clock-skew hardening
