## 1. SQLite D1 adapter

- [x] 1.1 Implement D1 prepared statements, result metadata, transactional batches and migrations using the existing SQL files.
- [x] 1.2 Add Node and Bun SQLite drivers and persistent sync/poll database files under `SIFT_DATA_DIR`.
- [x] 1.3 Replace the Vite development server shim with SQLite; move the subset shim to test helpers.
- [x] 1.4 Verify migrations are idempotent and failed batches roll back.

## 2. Runtime behavior

- [x] 2.1 Enable sync on Node and Bun only when `SIFT_DATA_DIR` is configured.
- [x] 2.2 Run daily sync cleanup and opt-in polling from a 10-minute in-process scheduler.
- [x] 2.3 Add coverage for capability routes backed by migrated local SQLite files.

## 3. Docker and publishing

- [x] 3.1 Declare `/data` as the persistent Docker data directory and retain the Bun runtime image.
- [x] 3.2 Publish semantic-version and `latest` tags and verify the GHCR image is publicly pullable.
- [x] 3.3 Document `docker run`, Compose, Node/Bun configuration and the single-process limit.

## 4. Specifications and delivery

- [x] 4.1 Resolve the open design decisions and define self-hosted storage, sync, polling and image-tag behavior.
- [x] 4.2 Run typecheck, lint, build, tests and strict OpenSpec validation.
