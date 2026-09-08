## 1. Sync API Support

- [x] 1.1 Extend the CLI capabilities response type to retain the server's `stats` capability and add a typed statistics-pull helper for `/sync/stats/pull`, including existing unauthorized, rate-limit, and unavailable-endpoint error handling; verify with API-focused CLI tests.
- [x] 1.2 Add validated package-metadata version loading that works from both `src` and compiled `dist`, and verify it returns the package version without invoking `fetch`.

## 2. Statistics Derivation

- [x] 2.1 Add a pure CLI statistics module that narrows server rows, filters live URL-deduplicated feeds, fills missing aggregate rows with zeroes, and derives browser-parity totals, rates, expected reads, read index, and backlog; verify safe handling of invalid counters and unavailable derived values with unit tests.
- [x] 2.2 Add deterministic default ordering for stats output and verify read-once descending order with title tie-breaking.

## 3. CLI Commands

- [x] 3.1 Add `stats [--json]` to usage text and argument dispatch, require an agent token, check the advertised stats capability, pull subscriptions and aggregate statistics, and produce synchronized/approximate human-readable output; verify successful and unsupported-deployment behavior.
- [x] 3.2 Implement the stable JSON stats envelope with summary and per-feed fields, ensuring JSON stdout contains no presentation or error text; verify it with machine-readable output tests.
- [x] 3.3 Add `--version` and `-v` dispatch before token loading or network access, reject unexpected arguments, and verify both flags print the package version successfully without calling `fetch`.

## 4. Documentation And Verification

- [x] 4.1 Document `siftctl stats --json`, its output fields, sync requirement, server-committed snapshot behavior, approximation, and `--version` usage in the README; verify the documented examples match the implemented output.
- [x] 4.2 Run the focused `siftctl` tests and package build, then run `npm run typecheck`, `npm run lint`, and `npm test`; verify all commands pass with no server or schema changes required.
