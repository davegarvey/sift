# D1 migrations

This directory contains SQL migrations for the device-sync D1 database.

## Production

Before deploying the Worker to production, apply pending migrations:

```sh
npx wrangler d1 migrations apply sift-sync --remote
```

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
