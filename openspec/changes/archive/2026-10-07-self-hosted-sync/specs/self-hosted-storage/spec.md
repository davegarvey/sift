# self-hosted-storage Specification

## Purpose
Define how Node, Bun and Docker persist sync and polling data in local SQLite databases while reusing the D1 routes and migrations.

## ADDED Requirements

### Requirement: SQLite implements the D1 storage contract
The self-hosted adapter SHALL implement the D1 methods used by Sift: `prepare`, `bind`, `first`, `all`, `run`, `batch` and `exec`. `batch` SHALL execute all statements in one transaction and roll back all changes if a statement fails. The adapter SHALL use the same SQL migrations as Cloudflare D1.

#### Scenario: A failed batch is rolled back
- **WHEN** a batch statement fails
- **THEN** no earlier statement in that batch SHALL remain committed

### Requirement: Local database files and migrations
When `SIFT_DATA_DIR` is configured, Node and Bun SHALL store sync state in `sift-sync.sqlite` and polling state in `sift-poll.sqlite` in that directory. They SHALL apply the corresponding migration files at startup and record applied migration filenames in a Wrangler-compatible `d1_migrations` table. Vite development SHALL use SQLite with a persistent default data directory. The Docker image SHALL set `/data` as its data directory and declare it as a volume.

#### Scenario: Fresh self-hosted startup
- **WHEN** a server starts with an empty data directory
- **THEN** both databases SHALL be created with their respective schemas
- **AND** sync routes SHALL be available

#### Scenario: Restart reuses data and skips applied migrations
- **WHEN** the server restarts with the same data directory
- **THEN** sync and polling data SHALL remain
- **AND** previously applied migration files SHALL NOT be reapplied

### Requirement: Self-hosted scheduled jobs
With a data directory, the server SHALL run sync daily cleanup at 03:00 UTC and SHALL check polling every 10 minutes only when `FEED_POLLING=true`. The same poll database size limit and batch configuration SHALL apply. A data directory supports one running Sift process; horizontal scaling is unsupported.

#### Scenario: Polling is disabled by default
- **WHEN** `SIFT_DATA_DIR` is configured and `FEED_POLLING` is not `true`
- **THEN** sync SHALL work
- **AND** no feed polling requests SHALL run

#### Scenario: Polling is enabled
- **WHEN** `SIFT_DATA_DIR` is configured and `FEED_POLLING=true`
- **THEN** polling SHALL run through the local poll database on a 10-minute schedule

#### Scenario: Multiple processes share one data directory
- **WHEN** more than one Sift process is configured to use the same data directory
- **THEN** the deployment SHALL be treated as unsupported
