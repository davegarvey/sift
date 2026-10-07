## 1. IndexedDB tracking and migration

- [x] 1.1 Add `lastSeenAt`, its index and a preserving version 10 to 11 migration; retain the version 9 body-split path.
- [x] 1.2 Stamp article writes and sync pulls, including existing items returned by insert-only sync.
- [x] 1.3 Cover new, version 9 and version 10 database layouts and migration preservation.

## 2. Age-based cleanup

- [x] 2.1 Remove unstarred body records after 90 days unseen in batches of at most 500 scanned items, with a persistent continuation key.
- [x] 2.2 Remove unstarred unread records after 365 days unseen, including their flag, marker and body records.
- [x] 2.3 Run cleanup after refresh sweeps and cover boundaries, flags, and bounded work.

## 3. Persistence and status

- [x] 3.1 Request persistent storage once after the first subscription and provide an explicit Settings retry.
- [x] 3.2 Show usage, quota, persistence state, item count and body count in Settings.
- [x] 3.3 Handle unsupported storage APIs and denied requests without breaking feed workflows.

## 4. Specifications and delivery

- [x] 4.1 Update item-body-storage and add storage-retention scenarios.
- [x] 4.2 Update README and AGENTS.md storage behavior.
- [x] 4.3 Run typecheck, lint, tests, build and strict OpenSpec validation.
