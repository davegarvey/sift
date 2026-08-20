## ADDED Requirements

### Requirement: siftctl group code

`siftctl status` SHALL display a short, display-only group identifier derived from the sync key — identical to the web app's `Group XK7B` — so a CLI user can confirm two devices belong to the same sync group. The sync key itself SHALL NOT be exposed.

#### Scenario: status shows the group code when paired
- **WHEN** `siftctl status` runs with a token configured
- **AND** the server supports `GET /sync/status`
- **THEN** the output SHALL include a `Group:` line with the group fingerprint (first 20 bits of SHA-256 of the sync key, 4 Crockford base32 characters)
- **AND** the fingerprint SHALL equal the web app's `fingerprintSyncKey` result for the same sync key

#### Scenario: status is unaffected on older servers
- **WHEN** `siftctl status` runs with a token configured
- **AND** the server returns 404 for `GET /sync/status` (predates the endpoint)
- **THEN** the command SHALL still exit 0
- **AND** the group line SHALL be omitted (text) / `groupFingerprint` SHALL be null (`--json`)

#### Scenario: status requires a valid credential
- **WHEN** `GET /sync/status` is called without a valid master key or agent token
- **THEN** the server SHALL return 401
