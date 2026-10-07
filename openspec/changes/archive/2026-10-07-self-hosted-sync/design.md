# Design: self-hosted sync

## Context

The server routes already target the small D1 API subset `prepare`, `bind`, `first`, `all`, `run`, `batch` and `exec`. Both Cloudflare D1 and embedded SQLite use SQLite SQL, so a local adapter can run the same routes and migration files without introducing a second dialect.

## Decisions

- Adapt `node:sqlite` and `bun:sqlite` behind one synchronous connection interface. Wrap prepared statements in the asynchronous D1 shape used by Hono routes.
- Implement `batch` with `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`, so all statements commit together or none do.
- Keep `d1_migrations` and migration filenames compatible with Wrangler. Store sync and polling state in separate SQLite files and apply each migration directory at startup.
- `SIFT_DATA_DIR` opts Node and Bun into local sync. `FEED_POLLING=true` additionally enables polling. Vite uses a local default data directory. The Docker image sets `/data` and declares a volume.
- Run the sync daily cleanup at 03:00 UTC and polling checks every 10 minutes from one in-process timer. The poller already performs its own daily registry and item maintenance.
- Support both Node and Bun. Node requires 22.13 or later. Keep the container on Bun for a smaller runtime image.
- Move the SQL-subset test shim under `tests/helpers`; production development and server paths use SQLite.
- Limit a data directory to one running server process. Do not claim that local SQLite supports horizontal scaling.
- Publish `latest` and semantic-version image tags on releases. Preserve the workflow's multi-architecture build and cache.

## Risks

- Native SQLite APIs differ between Node and Bun. The adapter test uses Node SQLite; Bun behavior needs the release build/runtime check.
- A failed migration must roll back both schema changes and its migration record. Each migration is applied in its own immediate transaction.
- The in-process timer stops with the server and will not run jobs while it is stopped. Polling resumes on the next startup.
- SQLite file locking does not provide application-level coordination for multiple Sift processes. The README states the single-process limit.
