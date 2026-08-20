## 1. Proxy & Caching Fixes (Items 1, 5)

- [x] 1.1 Remove `etag()` middleware from `/feed`, `/article`, and `/img` in `server/handle.ts`
- [x] 1.2 Add `Cache-Control: no-cache, no-store` to `/feed` and `/article` responses

## 2. Server Bugfixes (Items 2, 6, 11)

- [x] 2.1 Fix pairing code cron unit mismatch in `server/sync/cron.ts` (divide `pairingCutoff` by 1000)
- [x] 2.2 Batch `ensureSchema` DDL statements with `db.batch()` in `server/sync/schema.ts`
- [x] 2.3 Replace `deriveFeedIdFromItemId` with `decodeItemId` import in `server/sync/routes.ts`

## 3. IndexedDB Schema Changes (Items 3, 4, 17)

- [x] 3.1 Bump `DB_VERSION` to 6 in `src/db/types.ts`
- [x] 3.2 Remove dead `'by-feed-url'` index from `_oldVersion < 3` handler and remove empty `_oldVersion < 4` handler in `src/db/open.ts`
- [x] 3.3 Add `_oldVersion < 6` handler: create `by-url` index (non-unique) on feeds store, add `by-feed-published` index note
- [x] 3.4 Update `getFeedByUrl` in `src/db/feeds.ts` to use index

## 4. Dead Code Removal (Items 8, 9, 10)

- [x] 4.1 Remove dead token-sorting code (lines 19-31) and unused regex patterns in `src/opml/parse.ts`
- [x] 4.2 Remove dead `snapshotFeeds()` in `src/sync/merge.ts`
- [x] 4.3 Inline `getSettings`/`saveSettings` into `state.tsx` and delete `src/settings.ts`

## 5. Debuggability & Cleanup (Items 12, 14)

- [x] 5.1 Add `console.warn` to catch blocks in `src/opml/merge.ts:11`, `src/articles/service.ts:26`, `src/server/fetch.ts:12`
- [x] 5.2 Add `// why:` comments to all `as any`/`as unknown` casts (`db/open.ts:93`, `merge.ts:21-22`, `qr.ts:11`, `handle.ts:188`, `vite.config.ts:20`)

## 6. Configuration Hardening (Items 13, 15, 16)

- [x] 6.1 Change `git pull` to `git pull --ff-only` in `package.json`
- [x] 6.2 Update `wrangler.toml` compatibility_date to `2026-01-01`
- [x] 6.3 Add `build.sourcemap: 'hidden'` to `vite.config.ts`

## 7. Concurrent Access & Performance (Items 18, 19)

- [x] 7.1 Eliminate in-place mutation in `enqueueFlag` — always append, deduplicate at push time, clear by object identity in `src/sync/queue.ts`
- [x] 7.2 Refactor `bulkUpsertItems` in `src/db/items.ts` to batch-read existing items and flags via `getAll()` before processing

## 8. UI & Eviction Fixes (Items 20, 21)

- [x] 8.1 Add `el.setPointerCapture(e.pointerId)` in `src/components/River.tsx` swipe `onStart`
- [x] 8.2 Change `firstOpenedAt ?? -Infinity` → `+Infinity` in `src/articles/eviction.ts`

## 9. Verify

- [x] 9.1 Run `npm run typecheck`
- [x] 9.2 Run `npm run lint`
- [x] 9.3 Run `npm test`
