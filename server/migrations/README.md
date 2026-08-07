# D1 migrations

This directory contains SQL migrations for the device-sync D1 database.

## Production

Migrations are applied automatically by CI (`d1-migrations.yml`) whenever a
migration file lands on main — no manual step needed. To apply manually
(e.g., from a local checkout):

```sh
npx wrangler d1 migrations apply sift-sync --remote
```

The workflow requires the `CLOUDFLARE_API_TOKEN` (a token with D1 edit
permission) and `CLOUDFLARE_ACCOUNT_ID` repository secrets. Migration
application is idempotent (D1 tracks applied migrations in a
`d1_migrations` table), so re-running is safe.

## Local development

`wrangler dev` and `vite dev` use a local D1 (SQLite file under `.wrangler/`).
The schema is applied automatically by the sync routes on first request via the
`CREATE TABLE IF NOT EXISTS` statements in `server/sync/schema.ts`. To pre-seed
the local DB with the schema (recommended), run:

```sh
npx wrangler d1 execute sift-sync --local --file=./server/migrations/0001_sync.sql
```

The local DB persists across `wrangler dev` restarts as long as the `.wrangler/`
directory is preserved.
