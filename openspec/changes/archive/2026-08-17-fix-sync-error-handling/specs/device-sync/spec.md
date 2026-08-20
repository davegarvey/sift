## MODIFIED Requirements

### Requirement: Register is rate-limited per IP
The server SHALL limit `POST /sync/register` requests from the same IP to **100 per hour** (increased from 10 per hour). The response on exceeding the limit SHALL be HTTP 429 with a `Retry-After` header.

#### Scenario: Rate limit is 100 per hour per IP
- **WHEN** more than 100 `POST /sync/register` requests come from the same IP within an hour
- **THEN** the server SHALL respond with HTTP 429 and a `Retry-After` header

### Requirement: 401 from a known-locally key triggers auto-register
**MODIFIED** — error surfacing added:

When the server returns 401 and the local sync key is present in IndexedDB, the client SHALL call `POST /sync/register` with the local key and retry the original request. If the registration fails (e.g., 429 rate limit), the client SHALL log the error to the browser console and SHALL NOT silently swallow the failure.

#### Scenario: Auto-register failure logs to console
- **WHEN** `POST /sync/register` returns a non-2xx response (e.g., 429) during the auto-register flow
- **THEN** the client SHALL `console.error` the failure with the status code and retry-after value
- **AND** SHALL NOT retry indefinitely

## ADDED Requirements

### Requirement: Enable sync clears state on failure
If `triggerFirstTime()` (and thus the initial push + pull) fails for any reason during `enableSync()`, the system SHALL call `disableSync()` to clear the local sync key, `lastSyncAt`, and dirty set. This ensures the toggle shows as OFF on failure and a retry generates a fresh key rather than retrying a stale one.

#### Scenario: Enable sync fails and clears key
- **WHEN** the user enables sync
- **AND** `triggerFirstTime()` throws (registration rate-limited, network failure, server error)
- **THEN** the system SHALL call `disableSync()` to clear local sync state
- **AND** the Settings panel SHALL show the sync toggle in the OFF state
- **AND** the error SHALL propagate to the caller for UI surfacing

#### Scenario: Enable sync succeeds normally
- **WHEN** the user enables sync
- **AND** `triggerFirstTime()` completes without error
- **THEN** the sync key SHALL remain stored
- **AND** the Settings panel SHALL show the sync toggle in the ON state

### Requirement: Sync enable errors surfaced in UI
The Settings drawer SHALL display an inline error message when enabling sync fails. The error SHALL be rendered below the sync toggle with the text "Failed to enable sync" and the error details logged to the browser console.

#### Scenario: Error shown on sync failure
- **WHEN** the user enables sync
- **AND** the enable operation fails
- **THEN** an inline error message SHALL appear below the sync toggle in the Settings drawer
- **AND** the error details SHALL be logged to the browser console via `console.error`

#### Scenario: Error cleared on next attempt
- **WHEN** a sync error message is displayed
- **AND** the user attempts to enable sync again
- **THEN** the previous error message SHALL be cleared before the new attempt
