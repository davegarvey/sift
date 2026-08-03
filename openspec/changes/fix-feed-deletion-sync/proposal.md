## Why

Feed deletions do not propagate between synced devices. Deleting a feed on device A leaves it alive on device B indefinitely. The root cause is that the tombstone-apply rule compares `deleted_at` against the local `lastFetched`, which the background scheduler bumps on every fetch cycle (`src/feeds/scheduler.ts:97,105,135`) — a read-only operation, not a user action. A device that has fetched the feed after the deletion therefore rejects the tombstone on every delivery (tombstones are re-delivered on every pull because the pull cursor is a server monotonic counter while `row_at` is a client epoch timestamp and never catches up — see design.md), and since the scheduler keeps bumping `lastFetched`, the rejection is effectively permanent. The same `lastFetched`-as-authority pattern also silently breaks propagation of feed renames and tag edits (`src/sync/apply.ts:94,105,108`). Two secondary defects compound this: (a) every feed upsert carries an unconditional `deleted: {value: 0, at: now}` stamp (`src/sync/push.ts:44,57`) and the server clears any tombstone on *any* push (`server/sync/routes.ts:354-360`), so a metadata edit on the surviving device resurrects the feed server-side and on the deleting device; (b) deletion is per-`feed_id` only, but two devices can hold different `feed_id`s for the same URL (pre-pairing subscribes, re-subscribes), so a delete tombstones only one row and the sibling row re-delivers the feed on the next pull.

## What Changes

- Add a local-only `modifiedAt` timestamp to the `Feed` record, bumped on every user-initiated mutation (subscribe, title/tag edit, URL change) and never on background fetches. This is the new "local authority" baseline.
- Change the tombstone-apply rule: a remote `deleted=1` row SHALL delete the local feed iff the remote `deleted_at` is newer than the local user-mutation time. Replace all `lastFetched`-as-authority fallbacks in the feed merge with the user-mutation baseline so renames and tag edits propagate correctly too.
- Client push discipline: metadata-only feed upserts (title/tags/url) SHALL NOT carry the `deleted` field. Only explicit subscribe (re-subscribe) and delete events stamp `deleted`.
- Server tombstone-clear gate: the tombstone-clear step SHALL run only when the push explicitly carries the `deleted` field (subscription-state intent), not for metadata-only patches — so a metadata edit cannot resurrect a feed.
- Server delete extension: a `deleted=1` push SHALL tombstone every row sharing the deleted feed's URL, not just the targeted `feed_id`, so deletions stick even with duplicate-URL rows. New clients carry the feed URL on the delete payload (so deletes of feeds unknown server-side still tombstone URL siblings); the server falls back to a DB lookup for legacy URL-less deletes.
- Server re-subscribe identity: a subscribe push (`deleted: 0` + `feedUrl`) targeting a URL with a tombstoned row SHALL revive the tombstoned row under its existing `feed_id` instead of inserting a new row — preserving feed identity, items, and read state on other devices.
- Client queue ordering: `enqueueFeedDelete` SHALL drop pending `feed-upsert` entries for the same feed to prevent an enqueued upsert from fighting the delete.
- Background fetches SHALL NOT stamp any user-authority field (`urlAt` included) — the scheduler currently stamps `urlAt` with a fetch time on legacy records, which would poison the new tombstone-apply fallback.
- Update the `device-sync` spec (delta) and reconcile the conflict with the live `fix-sync-first-pairing` delta. The 30-day offline-device gap remains a documented limitation (a device that does not pull for 30+ days misses a deletion) — the only remaining delivery gap.

## Capabilities

### New Capabilities
<!-- None — this change modifies existing sync behavior only -->

### Modified Capabilities
- `device-sync`: Change the tombstone-apply rule from `lastFetched`-based to user-mutation-time-based (scenarios "Remote feed is tombstoned" / "Remote feed is tombstoned but local is fresher"). Change the tombstone-clear rule so only pushes carrying the explicit `deleted` field clear tombstones. Add requirements for the local user-mutation timestamp, deleted-stamp discipline on the client, delete-extension across duplicate-URL rows, and re-subscribe identity revival.

## Impact

- `src/db/types.ts` — `Feed.modifiedAt` field (optional; no IDB migration needed, store is schemaless).
- `src/feeds/service.ts` — set `modifiedAt` in `subscribeFeed`, `updateFeedMeta`, `changeFeedUrl`; stop stamping `deleted: 0` in metadata upserts.
- `src/feeds/scheduler.ts` — must NOT touch `modifiedAt` (spread preserves it).
- `src/sync/apply.ts` — new tombstone-apply rule; replace `lastFetched` fallbacks; preserve local `modifiedAt` on merge.
- `src/sync/push.ts` — omit `deleted` for metadata upserts (nullable `deleted`/`deletedAt` in the queue entry).
- `src/sync/queue.ts` — `DirtyEntry.feed-upsert.deleted` becomes nullable; `enqueueFeedDelete` coalesces pending upserts for the same feed.
- `server/sync/routes.ts` — tombstone-clear gated on `deleted` field presence; delete extends to all rows sharing the feed URL; subscribe revives a tombstoned row by URL.
- Tests: sync unit tests (`sync-client`, `sync-queue`), D1 integration tests (`tests/`), pairing e2e (including a duplicate-`feed_id`-per-URL case).
- Out of scope (deferred, documented): making `row_at` use the server monotonic counter (`server/sync/routes.ts:502-508` computes but discards it — legacy rows have epoch-scale `row_at`, so this needs a migration plan of its own); clock-skew hardening of field-level LWW; cross-device read-state convergence after a re-subscribe (flags are keyed by feed UUID; identity revival mitigates but does not fully restore prior divergence).
