## Context

Sift uses the feed URL as the IndexedDB primary key for feeds. This couples identity to location — you cannot change a feed's URL without re-keying every related record. The sync protocol mirrors this: the server D1 schema uses `feed_url` as part of the composite primary key.

The app is pre-v1 with few users. Breaking changes to persisted data and sync state are acceptable.

## Goals / Non-Goals

**Goals:**
- Decouple feed identity from URL by introducing a stable UUID primary key
- Make `feed.url` and `feed.title` editable through the feed editor modal
- Migrate all existing data (local IDB + server D1) to the new identity model
- Keep the sync protocol working with the new id-based wire format
- Preserve all existing read/starred state through the migration

**Non-Goals:**
- Preserve backward compatibility for old sync clients (re-pair required)
- Preserve existing reading-history `/i/<hash>` URLs (they contain the old feed URL in the hash input)
- Add multi-device sync of URL changes (the new `feed_url` field will sync by default via the per-field PATCH protocol)

## Decisions

### D1. Feed ID generation

**Decision**: Use `crypto.randomUUID()` (browser) and `crypto.randomUUID()` (Node 19+/Workers) to generate UUIDs at subscribe time.

**Rationale**: No dependency. Universally unique without coordination. Available in all target runtimes.

### D2. Item ID format

**Decision**: Change from `${feedUrl}::${guid}` to `${feedId}::${guid}`.

**Rationale**: The feed ID is stable for the lifetime of the subscription. Item IDs don't change when the URL changes. The `decodeItemId` / `encodeItemId` pair in `itemId.ts` handles wire encoding.

### D3. IDB migration (v4 → v5)

**Decision**: Delete old stores and recreate with new key paths in a single upgrade transaction.

```
upgrade(db, 4, 5, transaction):
  1. Read all feeds     → assign uuid per feed, build url→id map
  2. Read all items     → translate feedUrl→feedId, re-key item.id
  3. Read all flags     → translate feedUrl→feedId, re-key id
  4. Delete stores: feeds, items, itemFlags
  5. Create stores: feeds (keyPath: id), items (keyPath: id), itemFlags (keyPath: id)
  6. Create indexes: items.by-feed-published(['feedId','publishedAt']),
                     itemFlags.by-feed-id('feedId')
  7. Write all migrated data
```

**Rationale**: A single atomic upgrade transaction. If the callback throws (OOM, browser crash), IDB rolls back the upgrade entirely and the user retries on next load. The read phase happens before any delete, so the old data survives a crash in the write phase.

**Risk**: Loading all items into memory. For a personal RSS reader with typical usage (<50k items), this is a few MB. Acceptable for a one-time migration.

### D4. Server D1 migration

**Decision**: Drop old-style sync tables and recreate. Data loss is acceptable — clients re-push on first sync.

```
feeds_v1: PK (sync_key, feed_url)
flags_v1: PK (sync_key, item_id) with feed_url field

feeds_v2: PK (sync_key, feed_id)
          feed_url becomes a regular field with feed_url_at timestamp
flags_v2: PK (sync_key, item_id)  — item_id uses feed_id instead of feed_url
          feed_url column → feed_id
```

The `ensureSchema` function in `server/sync/schema.ts` checks a `schema_version` meta key. On mismatch, it drops old tables and creates new ones. The catch: existing sync data is lost. Since sync is re-pushable from clients (the first-time setup flow pushes all local state), this is acceptable.

**Rationale**: D1 doesn't support ALTER TABLE to change PKs. A full drop+recreate is the simplest correct approach at v0.x.

### D5. Sync wire format

**Decision**: Replace `feedUrl`/`feed_url` with `feedId`/`feed_id` in all feed and flag payloads. URL becomes an optional field with its own timestamp.

Push payload (before → after):
```
// Before
{ feedUrl: "https://old.com/rss", title: {...}, tags: {...}, deleted: {...} }

// After
{ feedId: "a1b2c3d4-...", feedUrl: { value: "https://new.com/feed", at: 1000 },
  title: {...}, tags: {...}, deleted: {...} }
```

Flag payload:
```
// Before
{ itemId: encodeURIComponent(feedUrl) + "::" + guid, feedUrl: "https://..." }

// After
{ itemId: encodeURIComponent(feedId) + "::" + guid, feedId: "a1b2c3d4-..." }
```

**Rationale**: Decouples identity from location on the wire. The per-field PATCH semantics already handle optional fields — when `feedUrl` is omitted, the server leaves it unchanged.

### D6. Editable fields save model

**Decision**: Mixed save model per the proposal.

- **Title**: Debounced 500ms on input. `onInput` handler sets local state, clears timer, sets new timer. On fire, calls `changeFeedTitle(feedId, value)`.
- **URL**: Saved on blur. On `onBlur`, validate URL format + not already subscribed. If changed from initial value, call `changeFeedUrl(feedId, newUrl)` immediately.
- **Tags**: Immediate per chip change (existing behavior, unchanged).

**Rationale**: Title as you type feels responsive. URL on blur avoids partial-URL saves and gives a natural validation point. Tags already work well with immediate saves.

### D7. Post-URL-change behavior

**Decision**: No automatic re-fetch. The user can trigger refresh via the sidebar Refresh button or wait for the scheduler's next tick.

**Rationale**: The URL change is a metadata update, not a content trigger. The scheduler will pick up the new URL on its next pass because `refreshFeed(feed)` uses `feed.url` to fetch. If the user wants content immediately, they click Refresh.

### D8. Reading URL breakage

**Decision**: Accept the breakage. No old-hash→new-hash redirect map.

**Rationale**: `hashId(item.id)` currently hashes the full item ID (`url::guid`). After migration, the item ID becomes `feedId::guid` which produces a different hash. Building a redirect map adds complexity to the migration with no clear benefit at v0.x. The reading URLs are internal (browser history, not shared externally).

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| IDB migration crash mid-way | Upgrade transaction is atomic — rollback preserves old schema. Retry on next load. |
| Missed `feedUrl`→`feedId` reference in query | TypeScript catches most of these. Index name changes (`by-feed-url`→`by-feed-id`) are grep-friendly. |
| Sync data loss on server migration | Drop+recreate is safe because clients re-push on first sync. |
| Old client pushes to new server | Not possible — app bundle deploys atomically with server. |
| Very large feed (>1000 items) migration performance | Cursor-based reads, batched writes. Existing `backfillFlags` function sets a precedent for large operations. |
| User edits URL to an invalid feed | Validation on blur: URL format check + not-already-subscribed check. The feed might still fail on refresh, which surfaces an error in the sidebar (existing behavior). |

## Migration Plan

1. **IDB migration** — ships with the app. Runs automatically on first load after update.
2. **Server migration** — `ensureSchema` detects version mismatch, drops old tables, creates new ones on cold start.
3. **Client re-pair** — users with sync enabled must re-pair after updating. The sync key survives; only the table schema changes.
4. **Deploy** — server and client deploy together (same `npm run deploy`). No multi-phase rollout needed at v0.x.
5. **Rollback** — `git revert` and redeploy. IDB migration is one-way — rolling back requires clearing site data (acceptable at v0.x).

## Open Questions

None. All key decisions are resolved above.
