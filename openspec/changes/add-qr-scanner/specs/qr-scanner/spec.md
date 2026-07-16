## ADDED Requirements

### Requirement: Sync section shows two action buttons
When sync is enabled, the settings Sync section SHALL display two buttons: "Join existing sync" and "Add another device". Each opens its respective modal.

#### Scenario: Join existing sync button
- **WHEN** sync is enabled
- **THEN** a "Join existing sync" button SHALL be visible
- **WHEN** the user taps it
- **THEN** the `SyncJoinModal` SHALL open

#### Scenario: Add another device button
- **WHEN** sync is enabled
- **THEN** an "Add another device" button SHALL be visible
- **WHEN** the user taps it
- **THEN** the `SyncShareModal` SHALL open

### Requirement: SyncJoinModal provides manual pairing
The `SyncJoinModal` SHALL provide a text input for an 8-character pairing code and a "Pair" button.

#### Scenario: Enter code and pair
- **WHEN** the user enters an 8-character code and taps "Pair"
- **THEN** `redeemCode()` SHALL be called with the code
- **THEN** on success, the modal SHALL close and the `PairResultModal` SHALL appear

#### Scenario: Empty code rejected
- **WHEN** the user taps "Pair" with an empty input
- **THEN** no action SHALL be taken

#### Scenario: Wrong length code rejected
- **WHEN** the user enters a code that is not 8 characters and taps "Pair"
- **THEN** an error SHALL be shown: "Enter an 8-character pairing code"

#### Scenario: Pairing error shown
- **WHEN** `redeemCode()` fails
- **THEN** an error message SHALL be displayed with the failure reason

### Requirement: SyncJoinModal provides QR scanning
The `SyncJoinModal` SHALL include a "Scan QR" button that opens the camera-based QR scanner overlay (QrScannerOverlay) within the modal.

#### Scenario: Scan QR button available
- **WHEN** the `SyncJoinModal` is open
- **THEN** a "Scan QR" button SHALL be visible

#### Scenario: Scan QR button disabled when no camera
- **WHEN** the device has no camera
- **THEN** the "Scan QR" button SHALL be disabled with a faded appearance

#### Scenario: Scanner opens on tap
- **WHEN** the user taps "Scan QR"
- **THEN** a full-viewport scanner overlay SHALL appear on top of the modal

#### Scenario: Scanner Escape closes scanner only
- **WHEN** the scanner overlay is open and the user presses Escape
- **THEN** the scanner SHALL close
- **THEN** the `SyncJoinModal` SHALL remain open

#### Scenario: Scanner success closes both
- **WHEN** the scanner successfully decodes a QR and pairing completes
- **THEN** the scanner SHALL close
- **THEN** the `SyncJoinModal` SHALL close
- **THEN** the `PairResultModal` SHALL appear

### Requirement: SyncShareModal displays pairing info
The `SyncShareModal` SHALL display the pairing code and QR code, and auto-generate them when opened.

#### Scenario: Code auto-generated on open
- **WHEN** the `SyncShareModal` opens
- **THEN** a new pairing code SHALL be generated automatically
- **THEN** the code SHALL be displayed in the modal
- **THEN** a QR code encoding the pair URL SHALL be displayed

#### Scenario: Copy button
- **WHEN** the pairing code is displayed
- **THEN** a "Copy" button SHALL be available
- **WHEN** the user taps Copy
- **THEN** the code SHALL be copied to the clipboard

#### Scenario: Code auto-refreshes on expiry
- **WHEN** the pairing code reaches its expiry time
- **THEN** a new code SHALL be generated automatically
- **THEN** the QR code SHALL update to encode the new code
- **THEN** no notification SHALL be shown to the user

#### Scenario: Timers cleanup on close
- **WHEN** the `SyncShareModal` closes
- **THEN** the expiry timer SHALL be cancelled
- **THEN** the countdown ring interval SHALL be cleared

### Requirement: Countdown ring shows code freshness
The `SyncShareModal` SHALL include a visual countdown ring positioned at the bottom-right of the modal body, indicating remaining code validity.

#### Scenario: Ring full on generation
- **WHEN** a new pairing code is generated
- **THEN** the countdown ring SHALL appear full (100% arc)

#### Scenario: Ring depletes over time
- **WHEN** time passes since code generation
- **THEN** the ring arc SHALL decrease proportionally to time remaining
- **THEN** when less than 30 seconds remain, the ring color SHALL change to red

#### Scenario: Ring resets on refresh
- **WHEN** the code auto-refreshes
- **THEN** the ring SHALL snap back to full

### Requirement: Scanner displays camera feed
The scanner overlay SHALL display the device camera feed in real time with a corner-bracket targeting frame to guide QR code alignment.

#### Scenario: Camera feed visible
- **WHEN** the scanner overlay opens
- **THEN** the live camera feed SHALL be displayed filling most of the viewport
- **THEN** a corner-bracket targeting frame SHALL be overlaid on the feed

#### Scenario: Camera permission denied
- **WHEN** the user denies camera permission
- **THEN** an error message SHALL be displayed explaining that camera access is needed
- **THEN** the user SHALL be offered "Try again" and "Enter code manually" options

#### Scenario: No camera available
- **WHEN** the device has no camera
- **THEN** an error message SHALL be displayed stating that no camera was found
- **THEN** the user SHALL be offered to close the scanner and enter the code manually

### Requirement: Scanner decodes QR codes
The scanner SHALL capture camera frames at regular intervals and attempt to decode QR codes using the `jsqr` library.

#### Scenario: Valid QR decoded
- **WHEN** a QR code is detected in the camera frame
- **THEN** the scanner SHALL validate that the decoded URL's origin matches `window.location.origin`
- **THEN** the scanner SHALL extract the `pair` query parameter from the validated URL
- **THEN** the scanner SHALL call `redeemCode()` with the extracted code
- **THEN** on success, the scanner SHALL close and display "Paired successfully"

#### Scenario: QR from different origin
- **WHEN** a QR code is detected whose URL origin does not match `window.location.origin`
- **THEN** the scanner SHALL ignore the frame and continue scanning
- **THEN** the scanner SHALL NOT call `redeemCode()`

#### Scenario: QR without pair parameter
- **WHEN** a QR code is detected whose URL has no `pair` query parameter
- **THEN** the scanner SHALL ignore the frame and continue scanning

#### Scenario: Redeem fails
- **WHEN** `redeemCode()` fails (network error, expired code, rate limit)
- **THEN** the scanner SHALL display an error message with the failure reason
- **THEN** the user SHALL be offered "Try again" and "Enter code manually" options

### Requirement: Scanner can be dismissed
The scanner overlay SHALL provide a way to close it without scanning.

#### Scenario: Cancel button
- **WHEN** user taps the "Cancel" button
- **THEN** the scanner overlay SHALL close
- **THEN** the parent modal SHALL remain open

#### Scenario: Escape key
- **WHEN** user presses the Escape key
- **THEN** the scanner overlay SHALL close
- **THEN** the parent modal SHALL remain open

### Requirement: Scanner cleans up resources
The scanner SHALL release all camera resources when dismissed or unmounted.

#### Scenario: Camera released on close
- **WHEN** the scanner overlay closes for any reason
- **THEN** all camera tracks SHALL be stopped
- **THEN** the video stream SHALL be released
- **THEN** the frame capture interval SHALL be cleared

### Requirement: Busy signals are separate
The pairing code generation and code redemption operations SHALL use independent busy signals so that one does not affect the other's UI state.

#### Scenario: Generating code does not affect Pair button
- **WHEN** the user clicks "Generate code" (or auto-generates)
- **THEN** the "Pair" button SHALL remain enabled and show "Pair" (not "Pairing…")

#### Scenario: Pairing does not affect Generate button
- **WHEN** the user clicks "Pair"
- **THEN** the "Generate code" button SHALL remain enabled
