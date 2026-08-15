# item-dates Specification

## Purpose

Defines how an item's publish timestamp is derived from feed data, stored, and rendered — ensuring items without a usable feed date (missing, unparseable, or future) get a stable, honest date instead of a fabricated "now".

## Requirements

### Requirement: Publish date derivation with first-seen fallback

When a feed entry provides a publish date, the system SHALL use it as the item's `publishedAt`, provided it parses successfully and is not in the future. When the feed entry's date is missing, unparseable, or in the future, the system SHALL set the item's `publishedAt` to the time the item was first ingested, never to the current time.

#### Scenario: Feed entry has a valid past date
- **WHEN** a feed entry includes a parseable publish date in the past
- **THEN** the item's `publishedAt` SHALL be that date

#### Scenario: Feed entry has no date
- **WHEN** a feed entry has no publish date field
- **THEN** the item's `publishedAt` SHALL be the time the item was first ingested

#### Scenario: Feed entry has an unparseable date
- **WHEN** a feed entry's publish date cannot be parsed
- **THEN** the item's `publishedAt` SHALL be the time the item was first ingested

#### Scenario: Feed entry has a future date
- **WHEN** a feed entry's publish date is in the future
- **THEN** the item's `publishedAt` SHALL be the time the item was first ingested

#### Scenario: Item appears with no date on first ingest
- **WHEN** an item with no usable date is ingested for the first time
- **THEN** its `publishedAt` SHALL equal its ingestion time

### Requirement: Fallback dates are flagged

When an item's `publishedAt` was derived from the first-seen fallback rather than a real feed date, the system SHALL record this on the item as a `dateFallback` flag. The flag SHALL be cleared when a subsequent feed entry provides a real, non-future date.

#### Scenario: Fallback used
- **WHEN** an item's date is derived from the first-seen fallback
- **THEN** the item SHALL be stored with `dateFallback` set

#### Scenario: Real date later appears
- **WHEN** a later feed refresh provides a real, non-future publish date for an item previously stored with `dateFallback`
- **THEN** the item's `publishedAt` SHALL be updated to the real date
- **AND** the `dateFallback` flag SHALL be cleared

### Requirement: Refresh never re-stamps dates

Refreshing a feed SHALL NOT overwrite the stored `publishedAt` or ingestion time of an existing item with a new fallback timestamp. For fallback-dated items, the original first-seen `publishedAt` and ingestion time SHALL be preserved across refreshes.

#### Scenario: Fallback-dated item refreshed
- **WHEN** a feed refresh re-parses an item whose stored date came from the fallback
- **THEN** the stored `publishedAt` SHALL remain the original first-seen time
- **AND** the stored ingestion time SHALL remain the original first-seen time

#### Scenario: Refreshed item without date keeps its real stored date
- **WHEN** a feed refresh re-parses an item that previously had a real feed date but the entry no longer provides one
- **THEN** the stored `publishedAt` SHALL remain the previously stored real date

### Requirement: Existing future dates are repaired once

The system SHALL, as part of a one-time migration on upgrade, set `publishedAt = ingestion time` for every stored item whose `publishedAt` is in the future, and SHALL mark those items as fallback-dated.

#### Scenario: Upgrade repairs future-dated items
- **WHEN** the app upgrades a database that contains items with future `publishedAt` values
- **THEN** each such item's `publishedAt` SHALL be set to its ingestion time
- **AND** each such item SHALL be marked fallback-dated
- **AND** the repair SHALL run only once, not on every launch

#### Scenario: Upgrade leaves valid items untouched
- **WHEN** the app upgrades a database whose items all have past `publishedAt` values
- **THEN** no item's `publishedAt` SHALL be modified

### Requirement: Date display guards

The system SHALL NOT render a non-positive `publishedAt` as "just now"; such items SHALL display as "unknown". Items with a future `publishedAt` SHALL NOT be displayed as "just now" either (such values SHALL NOT exist after the one-time repair; the guard covers data predating it).

#### Scenario: Unknown date displayed
- **WHEN** an item's `publishedAt` is non-positive
- **THEN** its relative-time display SHALL read "unknown"

#### Scenario: Valid date displayed
- **WHEN** an item's `publishedAt` is a valid past timestamp
- **THEN** its relative-time display SHALL reflect the time since that timestamp

### Requirement: Tooling reports unknown dates honestly

Tools that report live feed items (CLI listing, MCP feed inspection) SHALL report an entry with no usable publish date as date-unknown rather than fabricating the current time.

#### Scenario: CLI lists an entry without a date
- **WHEN** the CLI lists a feed entry whose date is missing, unparseable, or future
- **THEN** the entry's date SHALL be reported as unknown

#### Scenario: MCP inspects an entry without a date
- **WHEN** the MCP feed inspection tool returns an entry whose date is missing, unparseable, or future
- **THEN** the entry's publish date SHALL be reported as unknown
