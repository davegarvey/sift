## Context

The CLI currently reads subscriptions and flags through the sync API, while the browser stats view reads local IndexedDB aggregates and derives its metrics in `src/stats/service.ts`. The server already exposes `/sync/stats/pull`, and `/sync/capabilities` advertises whether that endpoint is available to authenticated agents. The CLI package has its own TypeScript build and cannot import the browser service without also importing its IndexedDB dependencies.

The release workflow updates both the repository and `packages/siftctl` package versions before publishing. The published package always includes its package metadata alongside `dist`, so the version command can use that metadata rather than introducing a second version constant.

## Goals / Non-Goals

**Goals:**

- Add a sync-backed `stats` read path with deterministic, browser-parity derived metrics.
- Produce a stable JSON contract that an LLM or shell script can consume without parsing presentation text.
- Preserve the existing token, base-URL, error, and exit-code conventions.
- Add a local-only version query that works before pairing and without network access.

**Non-Goals:**

- Reading statistics from browser IndexedDB or adding a browser-to-CLI bridge.
- Adding new server storage, routes, migrations, or statistics event history.
- Providing trends, reading duration, article content, or per-event chronology.
- Adding statistics mutation commands; the CLI remains read-only for aggregate statistics.

## Decisions

### Use the existing sync aggregate endpoints

The `stats` command will require the existing agent token, check the public capabilities response for `stats: true`, and then fetch the full baseline from `/sync/pull?since=0` and `/sync/stats/pull?since=0`. The two pulls can run concurrently after the token and capability checks. The feed pull supplies the live subscription set; the stats pull supplies aggregate counters. This avoids a server change and prevents old deployments from being presented as if they support local or synced statistics.

The command will reuse the CLI's live-feed filtering and URL deduplication rules. Stats rows for tombstoned or otherwise non-live feeds will not be emitted, and current feeds without a stats row will receive zero counters.

### Keep metric derivation pure and local to the CLI package

The CLI will add a small pure derivation module that narrows the server's snake_case response rows, validates non-negative safe integer counters, calculates the overall baseline, and derives per-feed rates, expected reads, read index, and backlog. It will mirror the formulas in the browser stats service, but will not import that service because it is coupled to the browser's IndexedDB modules and is built under a separate package root.

Focused tests will cover formula parity, missing rows, invalid counters, unavailable derived values, and deterministic ordering. The CLI will default to read-once descending order with title tie-breaking so human and machine output are stable without introducing another command option.

### Use an explicit machine-readable envelope

`--json` will emit one object containing `source: "sync"`, `approximate: true`, a `summary` object, and a `feeds` array. Summary and row field names will use the CLI's existing camelCase JSON convention. The approximate marker is required because server `total_seen` is an aggregate estimate across devices even though server-accepted once-read markers are deduplicated.

Human output will print the same summary and per-feed metrics in a concise table. It will state that the values are synchronized aggregates rather than implying they are a complete local history. Errors remain on stderr and never mix with JSON stdout.

### Read the version from package metadata

`--version` and `-v` will be dispatched before token loading or any network operation. A validated package-metadata read relative to the CLI module will provide the installed version in both source tests and the published `dist` layout. This follows the automated release bump and avoids maintaining a hard-coded version in source. Extra arguments remain usage errors.

### Handle capability and authentication failures explicitly

The API client will expose the `stats` capability and a typed statistics pull helper. Missing or false capability support will produce a clear statistics-unavailable runtime error. Unauthorized and rate-limited responses will use the CLI's existing API error conventions, including the existing re-pair guidance for 401 responses.

## Risks / Trade-offs

- **[Risk]** The CLI may lag behind a browser's pending local sync queue. **Mitigation:** label the result as `source: "sync"` and document that it is the server-committed snapshot.
- **[Risk]** Aggregate `total_seen` is not an exact union of all device article histories. **Mitigation:** always emit `approximate: true` and document the limitation in the CLI README section.
- **[Risk]** Older deployments may omit the stats capability or endpoint. **Mitigation:** check capabilities before pulling and fail without fabricating a local fallback.
- **[Risk]** API field names or malformed counters could produce misleading output. **Mitigation:** narrow response values, clamp invalid counts to zero, and test malformed rows.
- **[Risk]** Runtime package metadata resolution could differ between source execution and npm installation. **Mitigation:** resolve metadata relative to the module, test both the CLI command path and the package build, and rely on npm's package metadata inclusion.

## Migration Plan

No server migration is required. Implement and test the CLI, update the README, build the workspace package, and publish it through the existing release workflow. Rolling back the package release removes the command from the next installed version; it does not alter server data or existing tokens.
