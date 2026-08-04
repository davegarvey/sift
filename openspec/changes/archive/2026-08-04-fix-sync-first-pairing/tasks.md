## 1. Diff-based first-time setup

- [x]1.1 Rework `runFirstTimeSetup` in `src/sync/merge.ts`: always pull `since=0` first (regardless of `lastSyncAt`), compute the diff, push only the diff via the existing push path, then merge and advance `lastSyncAt`
- [x]1.2 Diff keys (normalization mandatory): feeds skipped when the server has a row with the same `feed_id` **or** the same URL; flags compared by raw local `ItemFlag.id` against server `item_id` decoded via `decodeItemId` (mirror apply.ts:137-140)
- [x]1.3 Keep the `read=0 && starred=0` skip for local flags
- [x]1.4 Remove the empty-payload full re-upload branch in `runFirstTimeSetup` (merge.ts:104-110); confirm the uniform diff covers no-change and wiped-server cases
- [x]1.5 Confirm `runPull` (incremental path) is untouched and still covered by existing tests

## 2. Clean-slate disable / re-enable

- [x]2.1 Update `disableSync` (state.tsx:424-426) to also clear `lastSyncAt` and the dirty set (standing spec: "Dirty set cleared on toggle off" — currently unimplemented)
- [x]2.2 Make `triggerFirstTime` start with an empty dirty set (prevents duplicate accumulation on retried setups and stale-while-disabled flag bleed into a new group)

## 3. Tests

- [x]3.1 Extend `tests/sync-pairing-e2e.test.ts:82` ("pushes pre-existing feeds when enabling sync") to a populated-server join: assert server rows' timestamps are untouched and only new local feeds are uploaded (note: with an empty server, diff ≡ push-all, so the existing assertions pass unchanged — the populated-server case is the new coverage)
- [x]3.2 Extend the pairing test at line 205 with the same populated-server assertions
- [x]3.3 Add e2e scenario: a local feed tombstoned on the server is removed locally on pairing and NOT re-uploaded
- [x]3.4 Add e2e scenario: local feed whose `feed_id` is tombstoned on the server with a changed URL (changeFeedUrl + delete) is NOT resurrected
- [x]3.5 Add e2e scenario: stale local tags do not overwrite newer server tags on pairing
- [x]3.6 Add e2e scenario: flag normalization — a local raw-id flag matching a server `item_id` is NOT re-pushed; newer server read/star value is preserved
- [x]3.7 Add e2e scenario: disable → re-enable with a fresh key through the real `disableSync` path (no manual meta clearing) converges correctly
- [x]3.8 Add e2e scenario: wiped-server recovery still re-populates the server from a populated local device
- [x]3.9 Run `npm test`, `npm run typecheck`, `npm run lint`

## 4. Verification follow-ups (post-verify)

- [x] 4.1 Add e2e scenario: a genuinely newer local edit on an existing feed is preserved locally and does not modify the server row (LWW local-newer-wins)
- [x] 4.2 Rename the stale "re-pushes feeds after disable and re-enable" test to reflect re-enable semantics
