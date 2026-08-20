## Why

A holistic code review identified 16 low-risk, high-value improvements across the codebase — bugfixes, performance optimizations, dead code removal, and best-practice hardening. These are individually small but collectively reduce maintenance burden, fix subtle correctness bugs, and align the codebase with TypeScript/security best practices.

## What Changes

1. Remove `hono/etag` middleware from `/feed`, `/article`, and `/img` proxy routes (it overwrites meaningful upstream ETags with body hashes, breaking conditional HTTP caching)
2. Fix cron cleanup unit mismatch: pairing code expiry stored in seconds but cron compares in milliseconds, so expired codes are never purged — actually the reverse, EVERY code is purged on every run because seconds < ms always
3. Remove dead `'by-feed-url'` index on `itemFlags` store (key path `feedUrl` doesn't exist on `ItemFlag`)
4. Add `by-url` index (non-unique) to feeds IndexedDB store so `getFeedByUrl` avoids full table scan — combined with Item 3 in DB_VERSION 5→6
5. Add `Cache-Control: no-cache, no-store` to `/feed` and `/article` proxy responses
6. Batch `ensureSchema` DDL statements via `db.batch()` for faster schema init
7. *(removed after red team — eviction already filters with cursor correctly)*
8. Remove dead sorting code in `opml/parse.ts` (tokens array, sort, and unused regex patterns)
9. Remove dead `snapshotFeeds()` placeholder function in `sync/merge.ts`
10. Remove `settings.ts` — inline `getSettings`/`saveSettings` into `state.tsx` and delete the file
11. Deduplicate `deriveFeedIdFromItemId` — replace with shared `decodeItemId` from `sync/itemId.ts`
12. Add `console.warn` to silent catch blocks that signal unexpected conditions: `opml/merge.ts:11`, `articles/service.ts:26`, `server/fetch.ts:12`. Leave others silent with documented intent.
13. Change `deploy` script to use `git pull --ff-only` for safety
14. Annotate all `as any`/`as unknown` casts with `// why` comments (including `vite.config.ts:20`)
15. Update `wrangler.toml` compatibility_date from 2024-12-01 to `2026-01-01`
16. Enable `build.sourcemap: 'hidden'` for production debugging
17. Remove empty `_oldVersion < 4` upgrade handler in `db/open.ts:90-91`
18. Eliminate in-place mutation in `enqueueFlag` (dirty queue) — always append new entries, deduplicate at push time, clear by object identity to fix race condition
19. Batch-read existing items + flags in `bulkUpsertItems` instead of O(n) serial IDB gets per item
20. Add `el.setPointerCapture(e.pointerId)` to swipe handler in `River.tsx` so gestures track outside element bounds
21. Fix eviction sort: `firstOpenedAt ?? -Infinity` → `+Infinity` so never-opened items retain their extracted HTML longest

## Capabilities

### New Capabilities
- `codebase-cleanup`: All 16 items above — a batch of independent fixes, optimizations, and cleanups with no new features

### Modified Capabilities
- *(none — no spec-level behavior changes)*

## Impact

- **Server**: `server/handle.ts`, `server/sync/cron.ts`, `server/sync/routes.ts`, `server/sync/schema.ts`
- **Client DB**: `src/db/open.ts`, `src/db/feeds.ts`, `src/db/types.ts`
- **Client Sync**: `src/sync/merge.ts`, `src/sync/apply.ts`
- **Articles**: `src/articles/eviction.ts`, `src/articles/extract.ts`, `src/articles/service.ts`
- **OPML**: `src/opml/parse.ts`
- **Feeds**: `src/feeds/discover.ts`
- **Config**: `package.json`, `wrangler.toml`, `vite.config.ts`
- **Meta**: `src/settings.ts` (delete), `src/sync/itemId.ts`
