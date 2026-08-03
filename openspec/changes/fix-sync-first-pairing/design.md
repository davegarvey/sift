## Context

`runFirstTimeSetup` (src/sync/merge.ts:88-114) has two branches:

1. `lastSyncAt == null` (fresh join) → `pushLocalState(existingFeeds, existingFlags)` re-pushes **all** local feeds/flags with `Date.now()` timestamps (merge.ts:48-78), then pulls `since=0` and merges.
2. `lastSyncAt != null` with an empty pull payload and non-empty local state → same full re-upload (merge.ts:104-110), a heuristic intended to recover from a wiped server.

The re-upload is destructive for three compounding reasons:

- `pushLocalState` stamps every field with `Date.now()` (merge.ts:52-63), so existing group rows get *synthetic fresh timestamps* from the joining device.
- The server clears tombstones unconditionally on any feed upsert (`UPDATE feeds SET deleted = 0, deleted_at = NULL WHERE … AND deleted = 1`, server/sync/routes.ts:354-360).
- Server-side LWW (`CASE WHEN at > existing_at THEN new ELSE old`) compares raw client wall clocks, so the joining device's fresh timestamps win.

Result: a device with stale local data joining a group resurrects deleted feeds and reverts newer tags. If the pull after the push fails, `lastSyncAt` stays null and every boot repeats it.

Two adjacent defects surface in the same flow:

- **`disableSync` doesn't clear `lastSyncAt` or the dirty set** (state.tsx:424-426 clears only `syncKey`), despite the standing device-sync spec requiring it ("Dirty set cleared on toggle off", "User re-enables sync with a new key … SHALL be empty"). A re-enable with a fresh key therefore enters `runFirstTimeSetup` with a stale `lastSyncAt`, and (with the heuristic removed) the new key's server would stay empty. Test 147 masks this by manually setting `lastSyncAt: null` (tests/sync-pairing-e2e.test.ts:170) — real `disableSync` never does.
- The server monotonic counter is a single global row (monotonic.ts:15-29), so post-wipe rows get small `row_at` values; a stale `lastSyncAt` means incremental pulls never deliver them either.

## Goals / Non-Goals

**Goals:**
- First-time setup must never overwrite server state that already exists.
- A joining device's own feeds/flags (not on the server) still join the group.
- A wiped-server recovery path must still work.
- Deleted feeds must propagate to the joining device, not be resurrected by it.
- Re-enable with a fresh key starts clean, per the standing spec.

**Non-Goals:**
- Change the push/pull wire protocol or server behavior (tombstone-clear, LWW PATCH, monotonic `row_at`).
- Fix client clock skew (separate concern; noted in Risks).
- Change the pairing UI or any component.
- Add push retry-with-backoff or a "resync from this device" escape hatch (separate concerns; the standing spec's backoff claim is not implemented in the code and is not addressed here).
- Handle silent data loss for an *established* pair whose server was wiped (pre-existing gap; self-heals on the next mutation — noted in Risks).

## Decisions

1. **`runFirstTimeSetup` always pulls `since=0` and diffs — regardless of `lastSyncAt`.** It is only invoked from `triggerFirstTime` (enable / pair / QR-boot) and from `bootSync` when `lastSyncAt` is null, so the cost is bounded to explicit first-time events, never normal boots. This makes every first-time setup a full reconciliation:

   ```
   pull since=0 ──▶ server feeds Fs, flags Gs
   diff:  upload  = local feeds whose (id ∉ Fs.ids AND url ∉ Fs.urls)
          upload += local flags whose rawId ∉ Gs.rawIds
   push upload (chunked, existing push path)
   applyRemoteState(payload)   // group authoritative for existing rows,
                               // tombstones applied locally, URL-dedupe merges IDs
   setStoredLastSyncAt(serverTime)
   ```

   No convergence re-push: the diff *is* the full set of local-only state. The empty-payload heuristic branch (merge.ts:104-110) is removed; under the uniform diff the "server fine, nothing changed → nothing pushed" and "server wiped → everything diffs as new → re-population" cases are both correct.

2. **Diff keys.** Feeds: skip a local feed when the server has a row with the **same `feed_id` OR the same URL** — either match means the group already knows this feed and the row must be reconciled by `applyRemoteState`, not re-pushed. A URL-only check is defeated by `changeFeedUrl` (feeds/service.ts:81-113) followed by deletion: the tombstoned server row carries the *new* URL, the joining device has the old one, a URL-only diff pushes it, and the server's unconditional tombstone clear (routes.ts:354-360) resurrects it. Flags: server `item_id` is `encodeURIComponent(feedId) + '::' + guid` (itemId.ts:6-8) while local `ItemFlag.id` is the raw `feedId::guid`; the diff MUST normalize server item IDs via `decodeItemId` (mirroring apply.ts:137-140) before comparison — otherwise every local flag appears new and gets re-pushed.

3. **Fresh timestamps on diff-pushed rows are safe.** A correctly-computed diff guarantees the pushed rows do not exist on the server, so `Date.now()` stamps (merge.ts:52-63) cannot clobber any existing row. The "synthetic timestamps" hazard only exists for rows that *do* exist server-side — which the diff never pushes (Decision 2). No local flag timestamps exist (db/flags.ts), so diff-pushed flags necessarily carry fresh stamps; harmless for the same reason.

4. **Clean-slate disable/re-enable (standing-spec implementation).** `disableSync` (state.tsx:424-426) SHALL also clear `lastSyncAt` and the dirty set, per the standing spec ("Dirty set cleared on toggle off"). `triggerFirstTime` SHALL additionally start with an empty dirty set so retried setups never accumulate duplicate entries (queue.ts has no feed dedupe) and no stale-while-disabled flags bleed into a new group. This also removes the stale-cursor failure mode (stale `lastSyncAt` > post-wipe `row_at`).

5. **Existing rows reconcile by LWW per field (unchanged), without synthetic re-stamping.** For rows the diff skips, the merge (`apply.ts:40-44`) compares the device's *existing* local timestamps against server timestamps. Caveats: `Feed` has no `folderAt` (db/types.ts:19 — folder is deprecated); `apply.ts:108` compares `rf.folder_at` against `local.lastFetched` as a proxy, so a folder-only local edit with `lastFetched == null` loses to the server. Accepted; fields with real timestamps (tags/title/url) behave correctly.

## Risks / Trade-offs

- [Behavioral] A joining device no longer "merges in" its stale versions of feeds that already exist in the group. Intentional — group is authoritative.
- [Payload size] First-time `since=0` pulls are unbounded (no pagination, routes.ts:539-547). At the standing caps (10k feeds, 1M flags) the payload is tens of MB and the in-memory diff + apply (a 1M-entry `flagMap`, one `bulkSetFlags`) approach browser/worker limits. This is not a regression — the current first-time flow already pulls and applies everything — but the diff adds the requirement to hold it all in memory. Documented; typical personal scale (thousands of flags) is fine; cap-scale is out of scope.
- [Established pair + wiped server] `runPull` on boot with a wiped server advances the cursor and the device keeps local state; the server stays empty until the next mutation triggers a push. Pre-existing gap, self-healing, out of scope.
- [Clock skew remains] LWW can still prefer a joining device's *existing* (non-synthetic) timestamps if its clock is ahead. The diff removes the dominant corruption path (re-stamping); full skew handling is a separate change.
- [Test masking] e2e test 147 manually clears `lastSyncAt` where real `disableSync` now will; keep the manual clear to test the clean-slate flow, but add a test exercising the real `disableSync` path.

## Implementation order

Implement before `add-sync-status`: both changes touch `runFirstTimeSetup`/`runPull` in merge.ts, and the status hooks (add-sync-status task 1.3) land cleanly on top of the rewritten flow.
