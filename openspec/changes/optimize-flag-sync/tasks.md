## 0. Client: Narrow DirtyEntry type (red team finding)

- [ ] 0.1 Narrow `DirtyEntry.flag-update` types: `read: 0 | 1` (not `0 | 1 | null`), `starred: 0 | 1` (not `0 | 1 | null`)
- [ ] 0.2 Remove conditional `if (e.read !== null)` / `if (e.starred !== null)` guards in `push.ts` — always emit both fields

## 1. Server: Single-statement flag upsert

- [ ] 1.1 Tighten flag payload validation in push handler — require both `read` and `starred` to be present (reject payload with missing fields)
- [ ] 1.2 Replace 3-statement PATCH block with single `INSERT OR REPLACE INTO flags (...) VALUES (...)` with all fields in one pass
- [ ] 1.3 Update `maxAt` to use `MAX(read.at, starred.at)` directly
- [ ] 1.4 Verify existing e2e tests pass (the sync-pairing test covers flag push)

## 2. Client: Dirty-queue dedup for flag updates

- [ ] 2.1 Add dedup check at the start of `enqueueFlag` — search in-memory dirty queue for existing `flag-update` with same `itemId` and same `read`/`starred` values
- [ ] 2.2 If match found with same values: update timestamps (`readAt`, `starredAt`) in-place and skip append (call `schedulePersist()`)
- [ ] 2.3 If match found with different values: replace the existing entry's values and timestamps (update in-place, call `schedulePersist()`)
- [ ] 2.4 Verify existing unit and e2e tests pass
