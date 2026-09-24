## ADDED Requirements

### Requirement: Transient refresh failures stay quiet

The client SHALL record refresh backoff for every failed feed refresh. It SHALL show the sidebar failure indicator unless the failure is transient (network failure, `408`, `419`, `425`, `429` or `5xx`) and the feed was last received from the server within the previous 24 hours. Non-transient failures, parse failures and transient failures lasting longer than 24 hours SHALL show the indicator.

#### Scenario: Rate limit on a recently updated feed

- **WHEN** a refresh returns `429` and the feed was received two hours ago
- **THEN** the sidebar SHALL not show a failure indicator for that feed
- **AND** the client SHALL not refresh the feed before its recorded retry time

#### Scenario: Feed has gone

- **WHEN** a refresh returns `404`
- **THEN** the sidebar SHALL show the failure indicator

#### Scenario: Prolonged rate limit

- **WHEN** a refresh returns `429` and the feed has not been received for more than 24 hours
- **THEN** the sidebar SHALL show the failure indicator

### Requirement: Feed editor shows refresh status

The client SHALL store, locally and without syncing, when the server last received each feed from its source (derived from `Age`) and, when the server reports `X-Sift-Retry-After`, when it will next contact the source. The feed editor SHALL show a single line with the time since the feed was received and, when the next check is in the future, its local time. No additional sidebar indicator SHALL be added.

#### Scenario: Feed served from a retained copy

- **WHEN** a refresh returns a stale representation with `Age: 2400` and `X-Sift-Retry-After: 900`
- **THEN** the feed editor SHALL show that the feed was updated 40 minutes ago and when it will next be checked

#### Scenario: Sync does not transfer refresh status

- **WHEN** a sync pull merges a feed
- **THEN** its local refresh status SHALL be preserved
- **AND** it SHALL not be sent to the sync service
