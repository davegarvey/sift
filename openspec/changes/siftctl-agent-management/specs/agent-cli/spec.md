## MODIFIED Requirements

### Requirement: siftctl command surface

The system SHALL provide a `siftctl` command-line program, published as an npm package with a `siftctl` bin, that operates against the hosted sync API (and, via a base-URL override, any Sift deployment). The command surface SHALL be: `pair <code>`, `status`, `feeds`, `feed add <url> [--title TITLE] [--tags TAG,...]`, `feed edit <url> (--title TITLE | --tags TAG,...)`, `feed remove <url> [--yes]`, `items <url> [--limit N]`, `mark read <itemId>`, and `help`. Unknown commands, missing required arguments, missing edit fields, and unexpected arguments SHALL exit with a usage error. Destructive commands SHALL require an explicit confirmation flag.

#### Scenario: Unknown command
- **WHEN** the user runs `siftctl` with an unknown or malformed command
- **THEN** the program SHALL print usage to stderr
- **AND** SHALL exit with a non-zero status distinct from runtime-error status

#### Scenario: Destructive command requires confirmation
- **WHEN** the user runs `feed remove <url>` without `--yes`
- **THEN** the program SHALL refuse and print the required flag
- **AND** SHALL exit non-zero without contacting the server

#### Scenario: Feed edit requires metadata
- **WHEN** the user runs `feed edit <url>` without `--title` or `--tags`
- **THEN** the program SHALL print a usage error
- **AND** SHALL not contact the server

### Requirement: siftctl feed mutations

The system SHALL provide `feed add`, `feed edit`, and `feed remove`. All feed URLs SHALL be trimmed and SHALL use the `http:` or `https:` protocol. `feed add` SHALL reuse the existing `feed_id` from a pull when the URL is already subscribed (rows are keyed by `feed_id`; the browser uses UUIDs, so reusing avoids duplicate rows); otherwise it SHALL use the URL as the `feed_id`. The push SHALL use bare field values (no timestamps) and SHALL succeed even when best-effort metadata discovery cannot fetch or parse the feed. `feed add` SHALL include an explicitly supplied title or tags, and SHALL otherwise include the feed title and HTML URL when discovery succeeds. `feed edit` SHALL resolve a live exact-URL subscription and update only the supplied title and/or tags without changing its deletion state. Tags SHALL be trimmed, lowercased, have internal whitespace collapsed, deduplicated, reject `all`, and be no longer than 64 characters. `feed remove` SHALL resolve a live exact-URL subscription and SHALL refuse without pushing when no such subscription exists.

#### Scenario: Add a feed with discovered metadata
- **WHEN** the user runs `feed add <url>` and the URL returns a parseable feed
- **THEN** the program SHALL push the URL and active subscription
- **AND** SHALL include the discovered title and HTML URL when present
- **AND** SHALL reuse an existing `feed_id` for the URL when one exists in a prior pull, else use the URL as the `feed_id`

#### Scenario: Add a feed
- **WHEN** the user runs `feed add <url>` with a valid token
- **THEN** the program SHALL push a feed entry with the URL and an active subscription
- **AND** the entry SHALL reuse an existing `feed_id` for the URL when one exists in a prior pull, else use the URL as the `feed_id`
- **AND** SHALL print a confirmation on HTTP 204
- **AND** SHALL exit non-zero with the server's error on failure

#### Scenario: Add a feed when discovery fails
- **WHEN** the user runs `feed add <url>` and metadata discovery fails
- **THEN** the program SHALL still push the URL and active subscription
- **AND** SHALL not invent a title or HTML URL

#### Scenario: Add a feed with explicit metadata
- **WHEN** the user runs `feed add <url> --title <title> --tags <tags>`
- **THEN** the explicit title and normalized tags SHALL be included in the feed push
- **AND** explicit metadata SHALL take precedence over discovered metadata

#### Scenario: Re-adding preserves custom metadata
- **WHEN** the user re-adds an existing subscription without explicit metadata
- **THEN** discovery SHALL not overwrite its existing title, HTML URL, or tags

#### Scenario: Edit feed metadata
- **WHEN** the user runs `feed edit <url> --title <title>` or `feed edit <url> --tags <tags>` for a live subscription
- **THEN** the program SHALL push the resolved `feed_id` with only the requested metadata fields
- **AND** SHALL preserve the other feed fields and active subscription state

#### Scenario: Clear feed metadata
- **WHEN** the user supplies an empty title or an empty tags value to `feed edit`
- **THEN** the program SHALL persist an empty title or empty tag array respectively

#### Scenario: Invalid feed URL
- **WHEN** the user supplies a URL that is empty, malformed, or uses a non-HTTP(S) protocol
- **THEN** the program SHALL print a usage error
- **AND** SHALL not contact the server

#### Scenario: Remove an unknown feed
- **WHEN** the user runs `feed remove <url> --yes` and no live subscription has that exact URL
- **THEN** the program SHALL report that the feed is not subscribed
- **AND** SHALL not push a tombstone

#### Scenario: Remove a feed
- **WHEN** the user runs `feed remove <url> --yes` for a live subscription
- **THEN** the program SHALL push a tombstone for the URL's resolved `feed_id`
- **AND** SHALL print a confirmation on HTTP 204

#### Scenario: Add and remove do not send timestamps
- **WHEN** the program builds a push payload for a feed mutation
- **THEN** the payload SHALL contain only bare field values
- **AND** SHALL NOT contain any `at` wrappers

### Requirement: siftctl items and mark read

The system SHALL provide `items <url> [--limit N]` and `mark read <itemId>`. `items` SHALL fetch the feed's XML directly, parse it, and print each item with its title, link, publication date, excerpt, and a Sift item ID derived as `encodeURIComponent(feedId) + '::' + guid`, where `feedId` SHALL be the live synchronized feed ID when the URL matches a subscription available to the paired token, and SHALL otherwise fall back to the feed URL for unauthenticated public inspection. `guid` SHALL follow the browser's item identity rules: the feed's `guid`, else the item `id`, else `${link}|${published}`, else `link`. `mark read` SHALL push a read flag for the given item ID.

#### Scenario: Items use the synchronized feed ID
- **WHEN** the user runs `siftctl items <url>` with a paired token and the URL matches a live subscription
- **THEN** each emitted item ID SHALL use that subscription's `feed_id`
- **AND** `mark read` on the emitted ID SHALL target the same flag row the browser uses

#### Scenario: Items with IDs
- **WHEN** the user runs `siftctl items <url>` with a valid token
- **THEN** the program SHALL print the parsed items (default limit 20)
- **AND** each item SHALL include its Sift item ID

#### Scenario: Public item inspection remains available
- **WHEN** the user runs `siftctl items <url>` without a token or for an unsubscribed URL
- **THEN** the program SHALL fetch and parse the feed directly
- **AND** each item ID SHALL use the URL as the feed ID fallback

#### Scenario: Item IDs match browser identity rules
- **WHEN** an item has no `guid` in the feed
- **THEN** the program SHALL derive the item ID using the same fallback order as the browser (id, then `${link}|${published}`, then `link`)

#### Scenario: Item IDs match the browser's identity rules
- **WHEN** an item has no `guid` in the feed
- **THEN** the program SHALL derive the item ID using the same fallback order as the browser (id, then `${link}|${published}`, then `link`)

#### Scenario: Mark item read
- **WHEN** the user runs `siftctl mark read <itemId>` with a valid token
- **THEN** the program SHALL push a read flag for the item
- **AND** SHALL print a confirmation on HTTP 204

#### Scenario: Items with unreachable feed
- **WHEN** the user runs `siftctl items <url>` and the feed cannot be fetched or parsed
- **THEN** the program SHALL print the error
- **AND** SHALL exit non-zero

### Requirement: siftctl output and exit-code contract

The system SHALL print data to stdout and errors to stderr. Exit codes SHALL be: 0 on success, 1 on runtime or API errors, 2 on usage errors. `--json` output SHALL be valid JSON on stdout with nothing else on stdout. `feed add`, `feed edit`, `feed remove`, and `mark read` SHALL accept `--json` in any supported argument position and SHALL return stable success objects containing `ok: true`, an operation name, and the affected URL, feed ID, or item ID. Unexpected arguments SHALL be rejected rather than silently treated as values. The JSON shapes SHALL be documented in the README.

#### Scenario: JSON mutation output is machine-readable
- **WHEN** the user runs a successful feed or item mutation with `--json`
- **THEN** stdout SHALL contain only its documented JSON result
- **AND** errors SHALL appear on stderr with exit code 1

#### Scenario: JSON output is machine-readable
- **WHEN** the user runs any data command with `--json`
- **THEN** stdout SHALL contain only the JSON payload
- **AND** errors SHALL appear on stderr with exit code 1

#### Scenario: Mutation rejects unexpected arguments
- **WHEN** the user supplies an unknown flag or extra positional argument to a mutation
- **THEN** the program SHALL print a usage error
- **AND** SHALL not contact the server
