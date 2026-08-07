## ADDED Requirements

### Requirement: Agent access management

The Settings Sync section SHALL provide an "Agent access" row that opens a modal listing paired agent tokens and allowing revocation. Revocation SHALL require confirmation.

#### Scenario: Agent tokens are listed
- **WHEN** the user opens the agents modal
- **THEN** the modal SHALL list each paired agent token with its fingerprint, scope, creation time, and last-seen time
- **AND** SHALL show a placeholder when no agents are paired

#### Scenario: Revoking an agent token requires confirmation
- **WHEN** the user activates revoke for a token
- **THEN** the system SHALL display a confirmation dialog naming the token's fingerprint
- **AND** SHALL revoke the token only on explicit confirmation
- **AND** after the dialog closes, the agents modal SHALL be shown again with the token removed

## MODIFIED Requirements

### Requirement: Sync key generation and storage

When the user enables device sync, the system SHALL generate a 128-bit cryptographically random sync key, encode it as URL-safe base64 (22 characters), and persist it in the browser's IndexedDB. The sync key SHALL be the user's identity for sync purposes; no account, email, or password is required.

#### Scenario: User enables sync for the first time
- **WHEN** the user toggles "Sync" on in Settings and no sync key is currently stored
- **THEN** the system SHALL generate 16 random bytes via `crypto.getRandomValues`
- **AND** SHALL encode the result as base64url
- **AND** SHALL store the encoded string in the IndexedDB meta store under the sync settings key
- **AND** SHALL expand the Sync section to the sync-on state (no pairing modal is opened; pairing is available from the "Pair another device" row)

#### Scenario: Sync key persists across app restarts
- **WHEN** the user closes and reopens the app
- **THEN** the previously generated sync key SHALL be available from IndexedDB
- **AND** no new key SHALL be generated

#### Scenario: User regenerates the sync key
- **WHEN** the user clicks "Regenerate" and confirms the confirmation dialog
- **THEN** a new 128-bit sync key SHALL be generated
- **AND** the previous key SHALL be replaced in IndexedDB
- **AND** the previous key's data on the server SHALL be orphaned (no migration is performed)

### Requirement: Unified pairing modal

The system SHALL provide a single pairing modal that exposes both pairing directions in one view: a source half that issues an 8-character server-generated OTP code and renders a QR code for the other device, and a target half that accepts an 8-character code or a 22-character sync key and offers camera-based QR scanning. The system SHALL NOT detect the device type or conditionally hide either half; the user picks the half that fits their situation. The modal SHALL be reachable from a single "Pair another device" row in the Settings Sync section.

#### Scenario: Source device shows all three flows
- **WHEN** a user with sync enabled opens the pairing modal
- **THEN** the source half SHALL display an 8-character OTP code with a copy button, a QR code, and a 5-minute countdown
- **AND** the code SHALL refresh automatically when it expires, resetting the countdown
- **AND** when a code refresh fails, the modal SHALL display an error with a retry affordance and SHALL NOT silently clear the code

#### Scenario: Target device (no existing key) opens the modal
- **WHEN** a user without a stored sync key opens the pairing modal
- **THEN** the target half SHALL display an input that accepts an 8-character code or a 22-character sync key, a "Pair" action, and a "Scan QR" action
- **AND** submitting an 8-character code SHALL redeem it via the server, store the returned key, trigger a first-time sync, and confirm success
- **AND** submitting a 22-character base64url key SHALL validate it locally without a server call, store it, trigger a first-time sync, and confirm success
- **AND** submitting a value that is neither SHALL show an inline validation error without calling the server
- **AND** submitting the key already in use SHALL show a notice ("Already paired with this key") without re-triggering a sync

#### Scenario: Modal layout on wide and narrow screens
- **WHEN** the modal is rendered on a wide screen
- **THEN** the source and target halves SHALL be side by side
- **WHEN** the modal is rendered on a narrow screen
- **THEN** the halves SHALL stack vertically with the source half on top

#### Scenario: Target scans a QR code
- **WHEN** the user activates "Scan QR" with a camera available
- **THEN** the system SHALL open the camera scanner overlay
- **AND** on a successful scan of a pairing QR for this origin, SHALL redeem the embedded code and pair
- **AND** when no camera is available, the "Scan QR" action SHALL be disabled with an explanatory tooltip

### Requirement: Sync status UI in Settings

The Settings panel SHALL include a Sync section, conditionally rendered when the server reports that sync is available via `GET /sync/capabilities`.

#### Scenario: Sync section is hidden when server has no D1 binding
- **WHEN** `GET /sync/capabilities` returns 404 or a body lacking `sync: true`
- **THEN** the Sync section SHALL NOT be rendered in Settings
- **AND** the capability check SHALL be performed on each page load (not cached across reloads)

#### Scenario: Sync-on state displays key and status
- **WHEN** sync is enabled
- **THEN** the Settings panel SHALL display, in order: a status line (last sync activity plus the display-only 4-character group fingerprint, with no copy affordance), a "Sync now" action, a "Pair another device" row that opens the unified pairing modal, an "Agent access" row that opens the agents modal, and a separated "Regenerate" row
- **AND** the group fingerprint SHALL be derived one-way from the sync key and SHALL NOT be used by any pairing flow
- **AND** the status line SHALL show the last error with its relative time when the last sync failed, the pending change count when changes are waiting, "Never synced" when no sync has ever succeeded, and otherwise the relative time of the last successful sync

#### Scenario: Last synced updates while drawer is open
- **WHEN** the Settings drawer is open
- **THEN** the status line's relative time SHALL be recomputed every 30 seconds

#### Scenario: Sync-off state displays the enable flow
- **WHEN** sync is disabled
- **THEN** the Settings panel SHALL display an "Enable sync" toggle that generates a key and expands the Sync section to the sync-on state

#### Scenario: Disabling sync requires confirmation
- **WHEN** the user toggles sync off while it is currently enabled
- **THEN** the system SHALL display a confirm dialog with the text: "Your other devices will stop syncing. Server data is kept until you generate a new key. Continue?"
- **AND** SHALL only clear the local sync key and the dirty set on explicit confirmation

#### Scenario: Regenerating requires confirmation
- **WHEN** the user activates "Regenerate"
- **THEN** the system SHALL display a confirmation dialog stating that regenerating revokes every agent token and that other devices must re-pair
- **AND** SHALL generate and store the new key only on explicit confirmation
- **AND** after the dialog closes, the Settings drawer SHALL be shown again with the updated fingerprint
