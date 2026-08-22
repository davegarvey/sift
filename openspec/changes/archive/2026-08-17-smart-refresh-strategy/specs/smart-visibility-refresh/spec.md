## ADDED Requirements

### Requirement: Gate visibilitychange refresh behind absence duration

The system SHALL only refresh (IDB reload + D1 pull) on tab return if the tab was hidden for at least 5 minutes AND the user was active at the time of hiding.

#### Scenario: Tab hidden for less than 5 minutes
- **WHEN** the tab becomes visible after being hidden for less than 5 minutes
- **THEN** no IDB reload, D1 pull, or UI update SHALL occur

#### Scenario: Tab hidden for 5+ minutes, user was active
- **WHEN** the tab becomes visible after being hidden for 5 or more minutes
- **AND** the user was not idle when the tab was hidden
- **THEN** the system SHALL call `reloadFeeds()`, `reloadItems()`, and `pullIfStale(30_000)`

#### Scenario: Tab hidden for 5+ minutes, user was idle
- **WHEN** the tab becomes visible after being hidden for 5 or more minutes
- **AND** the user was idle when the tab was hidden
- **THEN** the system SHALL call `reloadFeeds()` and `reloadItems()` but SHALL NOT call `pullIfStale` or perform any D1 pull

### Requirement: Throttle online event pulls

The `online` event listener SHALL use `pullIfStale` with a 2-minute threshold instead of `pullNow()` to avoid D1 request bursts during network flapping.

#### Scenario: Network returns after brief outage
- **WHEN** the `online` event fires
- **AND** the last D1 pull was less than 2 minutes ago
- **THEN** the system SHALL skip the D1 pull
