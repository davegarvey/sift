## MODIFIED Requirements

### Requirement: Sync status UI in Settings

**MODIFIED** — extends the existing requirement with the group fingerprint, a persistent status line, and pending-change display: the previously-required "Last synced" relative time and "Sync now" button SHALL be implemented as part of this change. The spec's separate "Regenerate" button requirement remains out of scope — pre-existing drift, deferred to a follow-up.

#### Scenario: Sync-on state displays key and status
- **WHEN** sync is enabled
- **THEN** the Settings panel SHALL display a "Pair device" button, a "Last synced" relative time, a "Sync now" button, and a group fingerprint
- **AND** SHALL display a pending-change count when the local dirty set is non-empty

#### Scenario: Last synced updates while drawer is open
- **WHEN** the Settings drawer is open
- **THEN** the "Last synced" string SHALL be recomputed every 30 seconds

#### Scenario: Sync now triggers pull and flush
- **WHEN** the user clicks "Sync now"
- **THEN** the system SHALL trigger a pull, await the flush of pending dirty entries, and record the outcome in the sync status (success or error)

#### Scenario: Push failure is visible while pulls succeed
- **WHEN** a push fails or has not completed (dirty set non-empty)
- **THEN** the Settings panel SHALL NOT display a healthy "Synced" state
- **AND** SHALL display the pending-change count, or the error from the failed attempt

#### Scenario: Sync failure is displayed
- **WHEN** a pull or push fails (network error, server error, rate limit)
- **THEN** the Settings panel SHALL display an error status with the relative time of the failed attempt
- **AND** the status SHALL persist across app reloads until the next successful or failed attempt replaces it
- **AND** a later successful pull SHALL NOT clear the error while the failing operation (push or pull) has not succeeded since

## ADDED Requirements

### Requirement: Group fingerprint display

The Settings panel SHALL display a short, display-only group identifier derived from the local sync key, so a user can confirm two devices belong to the same sync group.

#### Scenario: Fingerprint derived from sync key
- **WHEN** sync is enabled
- **AND** the Web Crypto API is available
- **THEN** the group fingerprint SHALL be the first 20 bits of the SHA-256 digest of the sync key, encoded as 4 Crockford base32 characters (alphabet `0-9 A-Z` minus `I`, `L`, `O`, `U`)
- **AND** the same key SHALL always produce the same fingerprint

#### Scenario: Web Crypto unavailable omits the fingerprint
- **WHEN** sync is enabled
- **AND** `crypto.subtle` is unavailable (insecure context such as plain-http LAN deployment)
- **THEN** the fingerprint row SHALL be omitted without error
- **AND** the rest of the Sync section SHALL render normally

#### Scenario: Raw sync key is never displayed
- **WHEN** the Settings panel renders sync information
- **THEN** the sync key itself SHALL NOT be displayed anywhere in the UI

#### Scenario: Fingerprint is copyable
- **WHEN** the user activates the copy control next to the fingerprint
- **THEN** the fingerprint string SHALL be copied to the clipboard

#### Scenario: Pairing row names the group
- **WHEN** sync is enabled
- **THEN** the "Add another device" row SHALL read "Add another device to group `<fingerprint>`" with an "Invite" action
