## Why

Three latent defects in the sync time model, deferred from `fix-feed-deletion-sync`:

1. **The pull cursor never catches up.** `row_at` is stamped with client epoch-ms (~1.75e12) while the pull cursor (`lastSyncAt`) stores the server's monotonic counter value — an integer starting near 0 (`server/sync/monotonic.ts:15-29`). `WHERE row_at > since` therefore matches **every row on every pull, forever**: tombstones re-deliver indefinitely and every pull is O(all data) (up to 10k feeds / 1M flags) against a 15s client timeout (`src/sync/client.ts:21`). The `batchT` value computed at `server/sync/routes.ts:502-508` is discarded (`void maxAt`), so the intended fix never landed.
2. **Cross-device clock skew silently misorders LWW.** All field stamps are client `Date.now()`. A device whose clock is skewed by seconds can misorder `deleted_at` vs another device's `modifiedAt` (the tombstone-apply decision), or field edits server-side — the one decision the deletion fix aims to make deterministic.
3. **Tombstones count against the 10k feed row cap.** `COUNT(*)` includes `deleted=1` rows (`routes.ts:433`), so delete→re-subscribe churn can eventually false-413.

## What Changes

- Replace the server's `server_time` plain counter with a **monotonic wall clock**: `nextMonotonicTime` stores `max(Date.now(), value + 1)`, and `currentMonotonicTime` reports `max(stored, Date.now())`. Values remain strictly increasing but now track epoch-ms, so they are directly comparable with client stamps and legacy rows.
- Stamp `row_at` with the server batch time (`batchT`) instead of client field stamps: strictly increasing, arrival-ordered, and the cursor (`lastSyncAt = serverTime`) catches up after one full pull — self-healing with no legacy migration needed.
- **Server-clock offset normalization on the client**: each device stores `sync_server_offset = serverTime - Date.now()` on every successful pull. Outgoing stamps are converted to the server frame at the wire boundary (`chunkToBody`), and incoming remote stamps are converted back to the local frame during apply (`applyRemoteState`). Server-side LWW then compares two server-frame estimates (skew-correct within RTT noise), and client-side comparisons (`userMutationTime < deleted_at`, feed-field merges) are corrected against a common frame.
- Exclude tombstoned rows from the per-user feed row cap.
- Update the `device-sync` spec (delta): "Monotonic server time" (counter → monotonic wall clock), "Push protocol" `row_at` semantics (server batch time), "Per-user row cap" (exclude tombstones), plus a new requirement for the client server-clock offset.

## Capabilities

### New Capabilities
<!-- None — this modifies existing sync behavior -->

### Modified Capabilities
- `device-sync`: "Monotonic server time" — the server time source becomes a monotonic wall clock (epoch-ms based, strictly increasing) instead of a free-running counter. "Push protocol with PATCH semantics" — `row_at` is stamped with the server batch time rather than `max(field_at)`. "Per-user row cap" — tombstoned rows are excluded from the feed count. ADDED requirement: client server-clock offset normalization (wire stamps in the server frame, local comparisons in the local frame).

## Impact

- `server/sync/monotonic.ts` — monotonic wall clock.
- `server/sync/routes.ts` — `row_at = batchT`; row-cap count excludes `deleted = 1`.
- `src/sync/client.ts` — nothing (pull response shape unchanged: `serverTime` now ≈ epoch-ms).
- `src/sync/key.ts` / `src/sync/merge.ts` — store/clear the server-clock offset; update it on every successful pull (including empty pulls).
- `src/sync/push.ts` — `chunkToBody` converts outgoing stamps to the server frame.
- `src/sync/apply.ts` — converts incoming remote stamps to the local frame before comparisons and before storing merged per-field timestamps.
- `src/sync/init.ts` / toggle-off — clear the offset with the other sync state.
- Tests: D1 integration (row_at monotonic/arrival-ordered, cursor catch-up, cap excludes tombstones), unit (offset normalization sign correctness, empty-pull offset updates), e2e (skewed-clock devices converge).
- Out of scope: HLC/device-ID logical clocks, server arbitration of within-RTT conflicts (residual skew = RTT noise, documented).
