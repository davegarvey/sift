## MODIFIED Requirements

### Requirement: siftctl command surface

The system SHALL provide a `siftctl` command-line program, published as an npm package with a `siftctl` bin, that operates against the hosted sync API (and, via a base-URL override, any sift deployment). The command surface SHALL be: `pair <code>`, `status`, `feeds`, `stats`, `feed add <url>`, `feed remove <url> [--yes]`, `items <url> [--limit N]`, `mark read <itemId>`, `help`, `--version`, and `-v`. Unknown commands, missing required arguments, and unexpected arguments SHALL exit with a usage error. Destructive commands SHALL require an explicit confirmation flag. The version flags SHALL not require a token or network access.

#### Scenario: Unknown command

- **WHEN** the user runs `siftctl` with an unknown or malformed command
- **THEN** the program SHALL print usage to stderr
- **AND** SHALL exit with a non-zero status distinct from runtime-error status

#### Scenario: Destructive command requires confirmation

- **WHEN** the user runs `feed remove <url>` without `--yes`
- **THEN** the program SHALL refuse and print the required flag
- **AND** SHALL exit non-zero without contacting the server

#### Scenario: Version does not require pairing

- **WHEN** the user runs `siftctl --version` or `siftctl -v`
- **THEN** the program SHALL print the installed package version to stdout
- **AND** SHALL exit successfully without reading a token or contacting the server

## ADDED Requirements

### Requirement: siftctl synchronized reading statistics

The system SHALL provide `siftctl stats` for a paired agent token. The command SHALL read aggregate statistics from the existing statistics sync API and current subscriptions from the existing sync pull API; it SHALL not require article-content downloads or access to browser-local IndexedDB. The command SHALL use only live, URL-deduplicated subscriptions in its result and SHALL represent a subscription with no aggregate row as zero observed and zero read-once articles.

The command SHALL derive metrics using the same lifetime formulas as the browser stats view: per-feed read rate is `readOnce / totalSeen` when `totalSeen > 0`; the overall read rate is the sum of `readOnce` divided by the sum of `totalSeen`; expected reads are `totalSeen * overallReadRate`; read index is `readOnce / expectedReads` when expected reads are positive; and backlog is `max(0, totalSeen - readOnce)`. Unavailable rates, expected reads, and read indexes SHALL be represented as unavailable rather than false zeroes.

#### Scenario: Stats are available to a paired agent

- **WHEN** the user runs `siftctl stats` with a valid agent token and the deployment advertises statistics support
- **THEN** the command SHALL return the current synced aggregate statistics for live subscriptions
- **AND** SHALL exit successfully

#### Scenario: Stats identify aggregate limitations

- **WHEN** the command returns synchronized statistics
- **THEN** its machine-readable result SHALL identify the source as synchronized data
- **AND** SHALL identify the result as approximate because observed article volume is an aggregate across devices
- **AND** SHALL not claim to contain article content, event history, reading duration, or time-series trends

#### Scenario: JSON stats are stable and LLM-readable

- **WHEN** the user runs `siftctl stats --json`
- **THEN** stdout SHALL contain only valid JSON
- **AND** the result SHALL contain a summary with `totalSeen`, `readOnce`, and `readRate`
- **AND** the result SHALL contain per-feed rows with `feedId`, `title`, `url`, `totalSeen`, `readOnce`, `readRate`, `expectedReads`, `readIndex`, and `backlog`
- **AND** errors SHALL be written to stderr rather than stdout

#### Scenario: Stats require synchronized agent access

- **WHEN** the user runs `siftctl stats` without a stored or environment token
- **THEN** the command SHALL fail with the existing not-paired guidance
- **AND** SHALL not contact the server

#### Scenario: Deployment lacks statistics support

- **WHEN** the user runs `siftctl stats` against a deployment that does not advertise statistics support
- **THEN** the command SHALL fail with a clear statistics-unavailable runtime error
- **AND** SHALL not present local-only or fabricated statistics as a result
