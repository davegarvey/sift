## ADDED Requirements

### Requirement: Server accepts single-statement flag upsert
The server SHALL accept a flag push payload containing both `read` and `starred` fields (neither is optional). The server SHALL use a single `INSERT OR REPLACE INTO flags (...) VALUES (...)` statement instead of the current 3-statement PATCH approach. The row_at SHALL be set to `MAX(read.at, starred.at)` in a single pass.

#### Scenario: Single-statement flag push succeeds
- **WHEN** client sends `POST /sync/push` with `{ itemId, feedId, read: { value, at }, starred: { value, at } }`
- **THEN** server executes 1 D1 statement (`INSERT OR REPLACE INTO flags`) instead of 3
- **AND** `flags.row_at` is set to `MAX(read.at, starred.at)`

#### Scenario: Missing read or starred field is rejected
- **WHEN** client sends `POST /sync/push` with flag payload missing `read` or missing `starred`
- **THEN** server returns 400 with descriptive error
- **AND** no D1 statement is executed

### Requirement: Client deduplicates pending flag updates in the dirty queue
Before appending a `flag-update` dirty entry, the client SHALL check whether an entry for the same `itemId` already exists in the in-memory dirty queue with the same `read` and `starred` values. If found, the client SHALL update the entry's `readAt` and `starredAt` timestamps in-place instead of appending a new entry. If the values differ, the client SHALL replace the existing entry with the new values and timestamps.

#### Scenario: Same flag with same values is enqueued twice
- **WHEN** `enqueueFlag({ itemId: "f::g", read: 1, readAt: 100, starred: 0, starredAt: 100 })` is called
- **AND** `enqueueFlag({ itemId: "f::g", read: 1, readAt: 200, starred: 0, starredAt: 200 })` is called before the first is flushed
- **THEN** the dirty queue contains 1 entry for `f::g` with the latest timestamps
- **AND** `dirty.length` is 1

#### Scenario: Same flag with different values replaces the existing entry
- **WHEN** `enqueueFlag({ itemId: "f::g", read: 1, readAt: 100, starred: 0, starredAt: 100 })` is called
- **AND** `enqueueFlag({ itemId: "f::g", read: 0, readAt: 200, starred: 0, starredAt: 200 })` is called before the first is flushed
- **THEN** the dirty queue contains 1 entry for `f::g` with the new values and timestamps
- **AND** the entry's read is 0, readAt is 200

#### Scenario: Different flags are not deduplicated
- **WHEN** `enqueueFlag({ itemId: "f::a", ... })` is called
- **AND** `enqueueFlag({ itemId: "f::b", ... })` is called before the first is flushed
- **THEN** the dirty queue contains 2 entries, one for each itemId
