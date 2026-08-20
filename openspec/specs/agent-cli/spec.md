# agent-cli Specification

## Purpose
TBD - created by archiving change add-agent-access. Update Purpose after archive.

## Requirements

### Requirement: siftctl command surface

The system SHALL provide a `siftctl` command-line program, published as an npm package with a `siftctl` bin, that operates against the hosted sync API (and, via a base-URL override, any sift deployment). The command surface SHALL be: `pair <code>`, `status`, `feeds`, `feed add <url>`, `feed remove <url> [--yes]`, `items <url> [--limit N]`, `mark read <itemId>`, and `help`. Unknown commands and missing required arguments SHALL exit with a usage error. Destructive commands SHALL require an explicit confirmation flag.

#### Scenario: Unknown command
- **WHEN** the user runs `siftctl` with an unknown or malformed command
- **THEN** the program SHALL print usage to stderr
- **AND** SHALL exit with a non-zero status distinct from runtime-error status

#### Scenario: Destructive command requires confirmation
- **WHEN** the user runs `feed remove <url>` without `--yes`
- **THEN** the program SHALL refuse and print the required flag
- **AND** SHALL exit non-zero without contacting the server

### Requirement: siftctl authentication provisioning

The system SHALL provide a `pair <code>` command that redeems an 8-character agent pairing code for a token and stores it locally. The token SHALL be read from, in order of precedence: the `SIFTCTL_TOKEN` environment variable, then the config file (`~/.config/siftctl/token`). The config file SHALL be created with owner-only permissions. `pair` SHALL overwrite the stored token only after a successful redemption. The base URL SHALL be configurable via the `SIFTCTL_URL` environment variable, defaulting to the hosted deployment.

#### Scenario: Pair succeeds
- **WHEN** the user runs `siftctl pair <code>` with a valid code
- **THEN** the program SHALL redeem the code
- **AND** SHALL write the token to the config file with owner-only permissions
- **AND** SHALL print a confirmation

#### Scenario: Pair with invalid code
- **WHEN** the user runs `siftctl pair <invalid-code>`
- **THEN** the program SHALL print the server's error
- **AND** SHALL exit non-zero
- **AND** SHALL NOT modify the stored token

#### Scenario: Environment token takes precedence
- **WHEN** `SIFTCTL_TOKEN` is set and the config file also exists
- **THEN** all commands SHALL authenticate with the environment token

### Requirement: siftctl status and feeds

The system SHALL provide `status` and `feeds` commands. `status` SHALL report the API's capabilities, the configured base URL, and whether a token is present (with its fingerprint, derived with the same algorithm the server and Settings UI use). `feeds` SHALL fetch the sync key's feed list via pull and print it, excluding tombstoned rows and deduplicating rows that share a feed URL. Both SHALL support `--json` output. Without a token, commands SHALL fail with a clear "not paired" message and a pointer to `siftctl pair` / `help`.

#### Scenario: Status with token
- **WHEN** the user runs `siftctl status` with a stored or environment token
- **THEN** the program SHALL print capabilities, base URL, and the token fingerprint

#### Scenario: Feeds lists subscriptions
- **WHEN** the user runs `siftctl feeds` with a valid token
- **THEN** the program SHALL print the sync key's live feeds (excluding tombstones)
- **AND** two rows sharing a feed URL SHALL be printed once (URL-deduplicated)
- **AND** `siftctl feeds --json` SHALL print the same data as JSON on stdout

#### Scenario: Unauthenticated command
- **WHEN** the user runs `feeds` (or any data command) with no token configured
- **THEN** the program SHALL print a "not paired" message with a pointer to `pair`
- **AND** SHALL exit non-zero without contacting the server

### Requirement: siftctl feed mutations

The system SHALL provide `feed add <url>` and `feed remove <url> [--yes]`. `feed add` SHALL reuse the existing `feed_id` from a pull when the URL is already subscribed (rows are keyed by `feed_id`; the browser uses UUIDs, so reusing avoids duplicate rows); otherwise it SHALL use the URL as the `feed_id`. The push SHALL use bare field values (no timestamps) and SHALL succeed regardless of whether the server can later fetch the feed. `feed remove` SHALL resolve the URL's `feed_id` from a pull when present, push a tombstone, and SHALL require `--yes`.

#### Scenario: Add a feed
- **WHEN** the user runs `siftctl feed add <url>` with a valid token
- **THEN** the program SHALL push a feed entry with the URL and an active subscription
- **AND** the entry SHALL reuse an existing `feed_id` for the URL when one exists in a prior pull, else use the URL as the `feed_id`
- **AND** SHALL print a confirmation on HTTP 204
- **AND** SHALL exit non-zero with the server's error on failure

#### Scenario: Remove a feed
- **WHEN** the user runs `siftctl feed remove <url> --yes`
- **THEN** the program SHALL push a tombstone for the URL's resolved `feed_id`
- **AND** SHALL print a confirmation on HTTP 204

#### Scenario: Add and remove do not send timestamps
- **WHEN** the program builds a push payload for `feed add` or `feed remove`
- **THEN** the payload SHALL contain only bare field values
- **AND** SHALL NOT contain any `at` wrappers

### Requirement: siftctl items and mark read

The system SHALL provide `items <url> [--limit N]` and `mark read <itemId>`. `items` SHALL fetch the feed's XML directly, parse it, and print each item with its title, link, publication date, excerpt, and a sift item ID derived as `encodeURIComponent(feedId) + '::' + guid`, where `feedId` is the feed URL as stored and `guid` follows the browser's item identity rules: the feed's `guid`, else the item `id`, else `${link}|${published}`, else `link`. `mark read` SHALL push a read flag for the given item ID.

#### Scenario: Items with IDs
- **WHEN** the user runs `siftctl items <url>` with a valid token
- **THEN** the program SHALL print the parsed items (default limit 20)
- **AND** each item SHALL include its sift item ID

#### Scenario: Item IDs match the browser's identity rules
- **WHEN** an item has no `guid` in the feed
- **THEN** the program SHALL derive the item ID using the same fallback order as the browser (id, then `${link}|${published}`, then `link`)
- **AND** `mark read` on the derived ID SHALL target the same flag row the browser would

#### Scenario: Mark item read
- **WHEN** the user runs `siftctl mark read <itemId>`
- **THEN** the program SHALL push a read flag for the item
- **AND** SHALL print a confirmation on HTTP 204

#### Scenario: Items with unreachable feed
- **WHEN** the user runs `siftctl items <url>` and the feed cannot be fetched or parsed
- **THEN** the program SHALL print the error
- **AND** SHALL exit non-zero

### Requirement: siftctl output and exit-code contract

The system SHALL print data to stdout and errors to stderr. Exit codes SHALL be: 0 on success, 1 on runtime or API errors, 2 on usage errors. `--json` output SHALL be valid JSON on stdout with nothing else on stdout. The JSON shapes SHALL be stable fields documented in the README.

#### Scenario: JSON output is machine-readable
- **WHEN** the user runs any data command with `--json`
- **THEN** stdout SHALL contain only the JSON payload
- **AND** errors SHALL appear on stderr with exit code 1