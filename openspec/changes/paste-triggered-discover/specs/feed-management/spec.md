## ADDED Requirements

### Requirement: Pasting into the Add Feed input SHALL trigger discovery

The Add Feed modal SHALL auto-trigger feed discovery when the user pastes content into the URL input. This replaces the previous behavior of proactively reading the clipboard on mount. The modal SHALL focus the input immediately on open so the user can paste without clicking.

#### Scenario: User pastes a feed URL into the input

- **WHEN** the user opens the Add Feed modal and pastes a URL into the input
- **THEN** the input is focused
- **AND** feed discovery fires automatically with no additional user action

#### Scenario: User pastes a non-URL into the input

- **WHEN** the user pastes content that is not a discoverable feed URL
- **THEN** discovery fires automatically
- **AND** the existing discovery error state is shown (same as pressing Enter on a bad URL)

## REMOVED Requirements

### Requirement: Modal auto-reads clipboard on mount

**Reason**: Replaced by paste-triggered auto-discover. Proactive clipboard reading without user action was unreliable (race condition, delayed focus) and privacy-intrusive.

**Migration**: The modal no longer calls `navigator.clipboard.readText()` on mount. Users paste their URL manually or use the system paste shortcut (Cmd/Ctrl+V).
