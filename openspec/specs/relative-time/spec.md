# relative-time Specification

## Purpose
TBD - created by archiving change add-relative-time. Update Purpose after archive.

## Requirements
### Requirement: Relative time formatting from ISO date string

`src/lib/relativeTime.ts` SHALL export a pure function `formatRelativeTime(isoDate: string, now?: Date): string`. The function SHALL compute the elapsed time between the parsed `isoDate` and `now`, defaulting `now` to the current time when omitted, and SHALL round the elapsed time to whole units at each step (seconds, then minutes, then hours, then days). The result SHALL be `"just now"` when the rounded elapsed second count is less than 60, `"{N}m ago"` when the rounded elapsed minute count is less than 60, `"{N}h ago"` when the rounded elapsed hour count is less than 24, and `"{N}d ago"` otherwise, where `{N}` is the rounded unit count. A date-only string of the form `YYYY-MM-DD` SHALL be interpreted as local midnight of that calendar day. The function SHALL throw a `RangeError` when `Number.isNaN(Date.parse(isoDate))`; any string `Date.parse` accepts — including rolled-over calendar dates such as `"2026-02-31"` and legacy non-ISO formats — SHALL be treated as valid input with `Date.parse` semantics.

#### Scenario: Date less than 60 seconds ago
- **WHEN** `formatRelativeTime` is called with an ISO date string 30 seconds before `now`
- **THEN** the result SHALL be `"just now"`

#### Scenario: Date less than 60 minutes ago
- **WHEN** `formatRelativeTime` is called with an ISO date string 5 minutes before `now`
- **THEN** the result SHALL be `"5m ago"`

#### Scenario: Date less than 24 hours ago
- **WHEN** `formatRelativeTime` is called with an ISO date string 3 hours before `now`
- **THEN** the result SHALL be `"3h ago"`

#### Scenario: Date more than 24 hours ago
- **WHEN** `formatRelativeTime` is called with an ISO date string 2 days before `now`
- **THEN** the result SHALL be `"2d ago"`

#### Scenario: Exactly at a bucket boundary
- **WHEN** `formatRelativeTime` is called with a date exactly 60 seconds, exactly 60 minutes, or exactly 24 hours before `now`
- **THEN** the result SHALL be `"1m ago"`, `"1h ago"`, or `"1d ago"` respectively

#### Scenario: Rounding within the seconds bucket
- **WHEN** `formatRelativeTime` is called with a date 59.6 seconds before `now`
- **THEN** the result SHALL be `"1m ago"` (the rounded second count is 60, which is not less than 60)

#### Scenario: Rounding within the hours bucket
- **WHEN** `formatRelativeTime` is called with a date 23.6 hours before `now`
- **THEN** the result SHALL be `"1d ago"` (the rounded hour count is 24, which is not less than 24)

#### Scenario: Date-only string interpreted as local midnight
- **WHEN** `formatRelativeTime` is called with `"2026-08-15"` and `now` set to 10:00 local time on 2026-08-15
- **THEN** the result SHALL be `"10h ago"` (the date is treated as 2026-08-15 00:00 local, independent of the caller's timezone)

#### Scenario: Timestamp with non-UTC offset
- **WHEN** `formatRelativeTime` is called with `"2026-08-15T00:00:00+05:30"` and `now` set to `"2026-08-15T10:00:00+05:30"`
- **THEN** the result SHALL be `"10h ago"` (offset-bearing timestamps are absolute instants, independent of the caller's timezone)

#### Scenario: Rolled-over calendar date accepted per Date.parse
- **WHEN** `formatRelativeTime` is called with `"2026-02-31"` and `now` set to 10:00 local time on 2026-03-03
- **THEN** the function SHALL NOT throw and the result SHALL be `"10h ago"` (`Date.parse` rolls the invalid calendar date over to 2026-03-03)

#### Scenario: Defaults to current time
- **WHEN** `formatRelativeTime` is called with `now` omitted and the date is seconds before the current time
- **THEN** the current time SHALL be used as the reference and the result SHALL be `"just now"`

#### Scenario: Invalid date string throws
- **WHEN** `formatRelativeTime` is called with a string for which `Number.isNaN(Date.parse(isoDate))` is true, such as `"garbage"` or the non-ISO `"15/08/2026"`
- **THEN** the function SHALL throw a `RangeError`

#### Scenario: Future date
- **WHEN** `formatRelativeTime` is called with an ISO date string in the future relative to `now`
- **THEN** the result SHALL be `"just now"`
