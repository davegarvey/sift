## ADDED Requirements

### Requirement: First-time pairing refreshes synchronized feeds immediately

After a device completes first-time pairing and applies the synchronized subscription state, the client SHALL immediately start refreshing every active feed in its local feed list. The initial refresh SHALL begin without waiting for the background scheduler's normal cadence.

#### Scenario: New device joins a sync group with feeds

- **WHEN** first-time pairing succeeds and the resulting local feed list contains one or more active subscriptions
- **THEN** the client SHALL start a refresh for every active subscription before the normal background scheduler would next refresh them

#### Scenario: New device joins an empty sync group

- **WHEN** first-time pairing succeeds and the resulting local feed list is empty
- **THEN** the client SHALL NOT start any feed requests
