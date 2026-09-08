## Why

`Sift` already synchronizes compact reading aggregates, but `siftctl` does not expose them. A stable, machine-readable stats command would let a shell-capable LLM understand reading habits and make feed recommendations without downloading article content or accessing the browser's local IndexedDB.

## What Changes

- Add `siftctl stats [--json]` for paired agent tokens.
- Add `siftctl --version` (and the conventional `-v` alias) without requiring network access or pairing.
- Read the synchronized aggregate statistics and current live subscriptions from the existing sync API.
- Derive the same lifetime totals, reading rates, expected reads, relative preference index, and not-read-yet estimate used by the browser stats view.
- Provide stable JSON containing an overall summary and per-feed rows suitable for LLM and script consumption, plus concise human-readable output.
- Make the sync-only and approximate nature of the data explicit; do not pretend to expose device-local statistics when sync is unavailable.
- Return a clear runtime error when the token is absent or the deployment does not advertise statistics support.
- Document the command, JSON shape, and sync/approximation limitations in the README.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-cli`: Extend the CLI command surface with a sync-backed, machine-readable reading statistics command.

## Impact

- `packages/siftctl` API client, command dispatch, statistics derivation, output formatting, and tests.
- Existing `/sync/pull`, `/sync/stats/pull`, and `/sync/capabilities` endpoints; no server schema or endpoint change is expected.
- README CLI usage and data-contract documentation.
