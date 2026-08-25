## Why

`siftctl` can subscribe and unsubscribe feeds, but it does not provide the metadata controls an agent needs to maintain a feed list. Adding a feed also drops its title and tags, and item IDs emitted for browser-created subscriptions do not identify the same sync records that `mark read` updates.

## What Changes

- Preserve feed title and HTML URL metadata when adding a feed, using explicit CLI values or best-effort feed discovery.
- Add a feed metadata edit command for updating a subscription's title and tags.
- Validate feed URLs and refuse to create tombstones when removing an unknown URL.
- Make item IDs use the existing synchronized feed ID when available so `mark read` targets browser-created subscriptions correctly.
- Add stable JSON results and strict argument handling for feed and item mutations so agents can consume command output safely.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-cli`: Extend the command surface and feed mutation behavior for metadata management, safe URL handling, stable item IDs, and machine-readable mutation results.

## Impact

- `packages/siftctl` CLI commands, feed parsing, API payload construction, and tests.
- The existing sync API feed payload fields (`title`, `htmlUrl`, and `tags`) are reused; no server schema change is expected.
- README CLI usage and output documentation.
