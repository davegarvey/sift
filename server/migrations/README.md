# D1 migrations

`server/migrations/` contains SQL migrations for the `sift-sync` D1 database
used by device sync and shared feed failure state. The separate
`server/migrations-poll/` directory contains migrations for the `sift-poll`
database used by server-side feed polling. Migrations are the single source
of truth for schema changes.

## How migrations run

Migrations are applied as part of the deploy pipeline, immediately before
`wrangler deploy` — so the schema always lands before the code that needs it:

- **Workers Builds (production deploys):** the deploy command is
  `npm run deploy:ci` (apply `sift-sync` and `sift-poll` migrations, then
  `wrangler deploy`). Configure this in the dashboard: Worker → Settings →
  Builds → Deploy command. The build's API token must include D1 edit
  permission (the auto-generated token does not — use your own token with
  D1 edit).
- **Previews (non-production branches):** the non-production branch deploy
  command stays at the default `npx wrangler versions upload` — previews
  deliberately do NOT run migrations. Schema changes apply only when a
  migration lands on main and the production deploy runs.
- **Manual deploys:** `npm run deploy` runs the same apply-then-deploy
  sequence for both databases.

There is deliberately no separate CI migration job: two mechanisms would
race, and migrations must run in the same pipeline as the deploy.

## Idempotency and rollback

`wrangler d1 migrations apply` records each applied migration in the
`d1_migrations` table, so re-running is a no-op for applied files. Per the
Cloudflare docs, a migration that errors is rolled back and the previous
successful migration remains applied.

## Local development

`wrangler dev` and `vite dev` use a local D1 (SQLite file under `.wrangler/`).
The runtime schema bootstrap (`server/sync/schema.ts`, idempotent
`CREATE TABLE IF NOT EXISTS` + swallowed additive `ALTER`s) creates a
usable schema on first request. To apply the real migrations locally
(recommended, keeps local and prod identical):

```sh
npx wrangler d1 migrations apply sift-sync --local
npx wrangler d1 migrations apply sift-poll --local
```

Create `sift-poll` with `npx wrangler d1 create sift-poll` and set its ID in
`wrangler.toml` before applying its migrations. Both local databases persist
across `wrangler dev` restarts as long as the `.wrangler/` directory is
preserved.

Migration `0006_feed_fetch_failures.sql` adds the shared feed failure table.
It stores only a SHA-256 URL key, failure status, retry timestamp, and update
timestamp; feed bodies and raw upstream URLs are never stored in this table.
The existing daily Worker cleanup removes rows after their retry timestamp.

Migration `0007_upstream_origin_policy.sql` adds shared per-origin request
reservations and cooldown state. It stores only a SHA-256 origin key, request
slot/cooldown timestamps, status, and challenge count. Expired idle rows are
removed by the daily Worker cleanup.

Migration `0008_feed_id_schema.sql` rebuilds `feeds` and `flags` in the
`feed_id`-keyed shape used by the sync routes. The stable feed ID change
(#427) recreated those tables at runtime from `server/sync/schema.ts` without
a matching migration, so a database built only from migrations kept the
`feed_url`-keyed tables from `0001` and every sync request failed. The
migration handles both shapes: columns missing from the old table are read
as `NULL` via a correlated subquery, rows from the runtime-created shape are
copied unchanged, and legacy rows without a `feed_id` (pre-#427 data that
current clients cannot address) are not copied. Re-running it on the target
shape is a no-op apart from the rebuild itself.

When adding columns to `feeds` or `flags`, update both this directory and
`server/sync/schema.ts` so the two paths keep producing the same schema; the
`sync D1 migrations` tests in `tests/sync-d1.test.ts` exercise a
migrations-only database.

Migration `0009_account_activity.sql` adds
`users.last_active_at`, which records recent sync activity for polling
maintenance.

The poll database has its own migration sequence. Migration
`server/migrations-poll/0001_feed_polling.sql` adds `polled_feeds` (per-URL
validators and schedule), `polled_items` (retained entries keyed by feed URL
and guid, with an `AUTOINCREMENT` sequence used as the `/sync/items` cursor)
and `poll_meta`. Polling URLs and entries do not contain sync keys. Daily poll
maintenance deletes items first seen more than 7 days earlier and removes
polling state for URLs no active group subscribes to. Each account contributes
at most 500 feed URLs; polling pauses above the configured
`POLL_DB_MAX_BYTES` size (8 GiB by default).
