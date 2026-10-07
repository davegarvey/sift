## ADDED Requirements

### Requirement: Zero-feed welcome state

When the user has no subscriptions and the river has no items, the river SHALL show a welcome that explains Sift briefly and states that the local library stays in the browser without an account. It SHALL offer actions to add a feed, subscribe to the curated sample feeds, open Settings for OPML import and open Settings to pair a device. It SHALL link to About. Existing readers with subscriptions SHALL never see this welcome state.

#### Scenario: Fresh install

- **WHEN** IndexedDB has no subscribed feeds and the app has hydrated
- **THEN** the river SHALL show the Sift welcome and the four actions
- **AND** activating Add a feed SHALL open the add-feed modal
- **AND** activating Try sample feeds SHALL subscribe to the curated feeds as ordinary removable subscriptions
- **AND** the About link SHALL open `/about`

#### Scenario: Reader already has subscriptions

- **WHEN** at least one feed is subscribed
- **THEN** the zero-feed welcome SHALL not be shown

#### Scenario: OPML import or device pairing

- **WHEN** the visitor chooses Import OPML or Pair a device
- **THEN** Settings SHALL open with the relevant subscription or sync controls available
