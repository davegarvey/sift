# D1 migrations

This directory contains SQL migrations for the device-sync D1 database.
Migrations are the single source of truth for schema changes.

## How migrations run

Migrations are applied as part of the deploy pipeline, immediately before
`wrangler deploy` — so the schema always lands before the code that needs it:

- **Workers Builds (production deploys):** the deploy command is
  `npm run deploy:ci` (`wrangler d1 migrations apply sift-sync --remote &&
  wrangler deploy`). Configure this in the dashboard: Worker → Settings →
  Builds → Deploy command. The build's API token must include D1 edit
  permission (the auto-generated token does not — use your own token with
  D1 edit).
- **Manual deploys:** `npm run deploy` runs the same apply-then-deploy
  sequence.

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
```

The local DB persists across `wrangler dev` restarts as long as the
`.wrangler/` directory is preserved.
