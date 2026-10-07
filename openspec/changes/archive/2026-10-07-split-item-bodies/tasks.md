## 1. Schema

- [x] 1.1 Add `ItemBody` and `ItemInput`, remove `html` and `extractedHtml` from `Item`, set `DB_VERSION` to 10, and remove `STORAGE_SOFT_CAP_RATIO` and `EVICTION_CHUNK_SIZE`.
- [x] 1.2 Replace the version 2 to 9 steps in `upgradeDb` with the version 10 baseline: create for a new database, strip bodies from version 9 records with a cursor, reset anything older.
- [x] 1.3 Add `blocking` (close and reload) and `blocked` (loading message) handlers to `getDb()`, an `upgrading` status set when the upgrade callback starts, and show both messages in `River`, with the blocked message taking precedence.

## 2. Write paths

- [x] 2.1 Split bodies from metadata in `bulkUpsertItems`, in one transaction, honouring `insertOnly`; type `parsedItemToItem` and `parsedToItems` as `ItemInput`.
- [x] 2.2 Delete bodies in `deleteItemsByFeed` and move them in `rekeyFeedId`.
- [x] 2.3 Add body read and extraction-write helpers and use them in `openItemForReading`.

## 3. Eviction removal

- [x] 3.1 Delete `src/articles/eviction.ts`, its scheduler call and `tests/eviction.test.ts`.

## 4. Tests

- [x] 4.1 Replace the historical migration tests with tests for version 10 creation, version 9 upgrade (bodies dropped, records stripped, other stores unchanged, abort on failure, extraction on first open) and the pre-version 9 reset.
- [x] 4.2 Cover body writes, merges, feed-HTML precedence, reading, deletion and body-free lists and search.
- [x] 4.3 Cover the `blocked`, `blocking` and `upgrading` states and their messages.
- [x] 4.4 Update tests that construct items with `html` or `extractedHtml`.

## 5. Documentation and verification

- [x] 5.1 Update the `AGENTS.md` architecture note and the README search limitation and any other description of article storage.
- [x] 5.2 Time the version 9 upgrade on 30,000 articles (median 29.7 s) and record it in the proposal and design.
- [x] 5.3 Run typecheck, lint, tests, build, `spec:validate`, strict change validation and the smoke tests.
