## ADDED Requirements

### Requirement: Detect user idle state

The system SHALL track user activity via DOM interaction events and expose an `isIdle()` function that returns `true` when no activity has been detected for 5 minutes.

#### Scenario: User is actively using the app
- **WHEN** the user moves the mouse, presses a key, scrolls, clicks, touches, or uses the mouse wheel within the last 5 minutes
- **THEN** `isIdle()` SHALL return `false`

#### Scenario: User walks away from the computer
- **WHEN** no DOM interaction events fire for 5 consecutive minutes
- **THEN** `isIdle()` SHALL return `true`

#### Scenario: User returns after idle period
- **WHEN** the first DOM interaction event fires after an idle period
- **THEN** `isIdle()` SHALL return `false` immediately after the event is processed

### Requirement: Fire catch-up on idle→active transition

The system SHALL detect the transition from idle to active and trigger a one-shot catch-up (sync pull + IDB reload) on the first interaction after an idle period.

#### Scenario: First mouse move after being idle
- **WHEN** the user moves the mouse after more than 5 minutes of inactivity
- **THEN** the system SHALL trigger `pullIfStale` and `reloadItems()` exactly once
- **AND** subsequent DOM events SHALL NOT trigger additional catch-ups until the next idle→active transition

### Requirement: Track activity via DOM events

The system SHALL listen to the following events on `document` with `passive: true`: `mousemove`, `mousedown`, `keydown`, `scroll` (with `capture: true`), `touchstart`, `click`, `wheel`, `pointerdown`.

#### Scenario: Scroll events from page content
- **WHEN** the user scrolls the river or any scrollable element in the page
- **THEN** the `scroll` event listener SHALL fire and reset the activity timestamp

#### Scenario: Activity detection with stylus
- **WHEN** a user interacts with a stylus or pointer device
- **THEN** the `pointerdown` event SHALL reset the activity timestamp
