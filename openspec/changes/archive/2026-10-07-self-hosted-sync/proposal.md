## Why

Sync, server-side polling, shared failure cooldowns and cross-request origin governance need a D1 binding, which exists only on Cloudflare Workers. A Docker, Node or Bun deployment therefore offers the local-only reader and the proxy, but not multi-device sync. Self-hosting should not require a specific hosting provider. D1 is SQLite, the sync and poll migrations are written in SQLite's dialect, and the server uses a small part of the D1 API (`prepare`, `bind`, `first`, `all`, `run`, `batch`, `exec`). A SQLite adapter can therefore run the existing routes and migrations unchanged. Postgres would need a second SQL dialect, translated migrations, two code paths to keep in step and a second container, with no benefit for a single-household instance.

## What Changes

- Add a D1-compatible adapter over embedded SQLite (`bun:sqlite` for Bun, `node:sqlite` for Node) implementing the subset of `D1Database` the server uses, with `batch` running in a transaction to match D1 semantics.
- Apply `server/migrations/` and `server/migrations-poll/` at startup from a migrations table compatible with Wrangler's, so one migration set serves every target. Keep sync and poll data in separate database files, mirroring the two D1 databases.
- Enable sync and, when configured, polling in the Node and Bun adapters when a data directory is set (for example `SIFT_DATA_DIR`), with polling scheduled by an in-process timer equivalent to the Workers cron triggers, including daily maintenance.
- Replace the development use of `server/sync/local-d1.ts` with the SQLite adapter. Move the limited SQL shim to `tests/helpers/` for existing unit tests that use it as a lightweight fixture.
- Update the Dockerfile with a data volume, and document running the published GHCR image (`ghcr.io/davegarvey/sift`) with sync and polling, including `docker run` and Compose examples.
- Confirm the GHCR package is public and that release builds publish a `latest` tag and semantic-version tags.

## Capabilities

### New Capabilities

- `self-hosted-storage`: the SQLite adapter, migrations at startup, data directory configuration, and scheduled jobs outside Workers.

### Modified Capabilities

- `device-sync`: sync available on Node, Bun and Docker deployments.
- `server-feed-polling`: polling available outside Workers.
- `ghcr-publish`: image tags and documented usage.

## Impact

New server storage module, `server/node.ts`, `server/bun.ts`, `vite.config.ts` (dev middleware), `server/sync/local-d1.ts` (removed), tests that construct `LocalD1Database`, `Dockerfile`, `.github/workflows/publish-ghcr.yml`, `.env.example` and README. The Bun runtime image may need a newer `oven/bun` tag; Node's SQLite module requires Node 22.13 or later.

## Decisions

- Self-hosted SQLite is single-process per data directory. Horizontal scaling and multiple writers across Sift instances are out of scope; SQLite files are not a shared-volume cluster database.
- Keep both Node and Bun server paths. Node uses `node:sqlite` and requires Node 22.13 or later; Bun uses `bun:sqlite`. The multi-architecture Docker image remains Bun-based.
- A configured `SIFT_DATA_DIR` enables sync. Polling additionally requires `FEED_POLLING=true`. Vite development uses a local default data directory so the sync routes can be exercised.
- The release workflow publishes semantic-version tags and `latest` from version tags; the package must be publicly pullable before documenting GHCR use.

## Non-goals

Postgres or other database servers, multi-instance deployments sharing one database, migration tooling between Cloudflare D1 and self-hosted SQLite, and a Docker Hub mirror.
