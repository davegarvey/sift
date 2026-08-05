## ADDED Requirements

### Requirement: Feed refresh distinguishes transient rate-limit errors

The system SHALL classify a 429 response from the `/feed` proxy as a distinct rate-limit error and SHALL surface the upstream `Retry-After` value to the refresh scheduler. The scheduler SHALL honor `Retry-After` given as integer seconds; an HTTP-date value SHALL be converted with `Date.parse`; any other value (absent, non-numeric, unparseable) SHALL fall back to the default fallback duration. Non-429 error responses SHALL remain classified as generic fetch errors, and any `Retry-After` on them SHALL be ignored.

#### Scenario: Feed returns 429 with numeric Retry-After
- **WHEN** a feed refresh receives a 429 response whose `Retry-After` header is an integer number of seconds
- **THEN** the scheduler records the rate-limit state with the next attempt scheduled no earlier than that many seconds later

#### Scenario: Feed returns 429 with HTTP-date Retry-After
- **WHEN** a feed refresh receives a 429 response whose `Retry-After` header is an HTTP-date
- **THEN** the scheduler converts it and schedules the next attempt no earlier than that date

#### Scenario: Feed returns 429 with no Retry-After
- **WHEN** a feed refresh receives a 429 response with no `Retry-After` header
- **THEN** the scheduler records the rate-limit state with the default fallback duration

#### Scenario: Feed returns 429 with unparseable Retry-After
- **WHEN** a feed refresh receives a 429 response whose `Retry-After` header is non-numeric or otherwise unparseable
- **THEN** the scheduler treats it as absent and falls back to the default duration, and the resulting `retryAt` is never NaN

#### Scenario: Feed returns 429 with Retry-After of zero
- **WHEN** a feed refresh receives a 429 response with `Retry-After: 0`
- **THEN** the scheduler schedules the next attempt at the next scheduler tick

#### Scenario: Feed returns 503 with Retry-After
- **WHEN** a feed refresh receives a 503 (or other non-429 status) response that carries a `Retry-After` header
- **THEN** the scheduler classifies it as a generic fetch error and ignores the header

#### Scenario: Feed returns other non-2xx status
- **WHEN** a feed refresh receives a 5xx, 4xx (non-429), or network error
- **THEN** the scheduler records a generic fetch error with no rate-limit semantics

### Requirement: Error backoff does not distort the learned refresh cadence

The system SHALL keep failure backoff separate from `learnedIntervalMs`. A failed refresh SHALL NOT increase `learnedIntervalMs`, and a 304 response SHALL leave it unchanged. Parse failures (a 200 response whose body fails to parse) SHALL be treated as generic errors and SHALL use the same error backoff as other generic failures.

#### Scenario: Failure while in a short learned interval
- **WHEN** a feed with a small `learnedIntervalMs` fails to refresh
- **THEN** `learnedIntervalMs` is unchanged and the error backoff state is tracked independently

#### Scenario: Parse failure uses error backoff
- **WHEN** a feed refresh returns a 200 whose body does not parse as a feed
- **THEN** the failure is recorded as a generic error with error backoff, and `learnedIntervalMs` is unchanged

#### Scenario: 304 leaves the learned interval unchanged
- **WHEN** a feed refresh returns a 304 not-modified
- **THEN** `learnedIntervalMs` is unchanged

#### Scenario: Recovery after repeated failures
- **WHEN** a feed that has failed several times succeeds on a later attempt
- **THEN** the error backoff state is cleared and, if `learnedIntervalMs` had been inflated above the default by previous errors, it is reset to the default interval

### Requirement: Error-state feeds are never retried before retryAt and are retried at a guaranteed floor frequency

A feed with error state SHALL be scheduled for its next attempt no earlier than its recorded `retryAt`, and this gate SHALL take precedence over the learned-interval staleness check — an old `lastFetched` alone SHALL NOT cause an earlier attempt. While the scheduler is running, a feed in an error state SHALL be attempted at least once per bounded ceiling (6 hours for generic errors, 24 hours for a clamped `Retry-After`), regardless of prior failures. This guarantee applies while the scheduler runs (a tab is open and visible); when a tab is hidden or closed, attempts resume at the next scheduler tick after it becomes visible.

#### Scenario: Old lastFetched does not bypass retryAt
- **WHEN** a feed in an error state has a `lastFetched` far older than `retryAt`
- **THEN** the feed is not attempted before `retryAt` on any scheduler tick

#### Scenario: Rate-limited feed is retried while failing
- **WHEN** a feed has been receiving 429s repeatedly
- **THEN** the feed is still scheduled for a retry attempt within the error-retry ceiling

#### Scenario: Rate-limit backoff shorter than the floor
- **WHEN** a feed receives a 429 with a `Retry-After` shorter than the generic-error floor
- **THEN** the next attempt occurs no earlier than the `Retry-After` duration

#### Scenario: Retry-After exceeds the generic-error ceiling
- **WHEN** a feed receives a 429 with a `Retry-After` longer than the generic-error ceiling
- **THEN** the next attempt is scheduled for the `Retry-After` duration, clamped to at most 24 hours, and the clamp overrides the generic-error ceiling

#### Scenario: Upstream recovers from rate limiting
- **WHEN** an upstream that was returning 429s starts accepting requests
- **THEN** the next scheduled retry succeeds and the feed returns to its normal refresh cadence without user action

#### Scenario: Tab hidden past retryAt, then re-visible
- **WHEN** a feed's `retryAt` passes while the tab is hidden or closed
- **THEN** the feed is attempted at the first scheduler tick after the tab becomes visible

#### Scenario: Force refresh during backoff
- **WHEN** the user triggers a force refresh for a feed in an error state before its `retryAt`
- **THEN** the feed is fetched anyway, and a further failure re-records its error backoff

### Requirement: Successful refresh clears error state

The system SHALL clear a feed's error state (`lastError` and error-backoff tracking) on a successful fetch or a 304 not-modified response, restoring normal cadence behavior. On a successful fetch (200 with parseable content), a `learnedIntervalMs` inflated by previous errors SHALL be reset to the default interval; a 304 SHALL NOT modify `learnedIntervalMs`.

#### Scenario: Fetch succeeds after errors
- **WHEN** a feed in an error state returns a 200 with parseable content
- **THEN** the error state is cleared, an error-inflated `learnedIntervalMs` is reset to the default, and the feed's next refresh is governed by the learned interval

#### Scenario: 304 after errors
- **WHEN** a feed in an error state returns a 304 not-modified
- **THEN** the error state is cleared, `learnedIntervalMs` is unchanged, and the feed's next refresh is governed by the learned interval

### Requirement: Error state is device-local

The system SHALL treat a feed's error-backoff state as device-local: it is persisted locally so it survives reloads, and it SHALL NOT be sent to or merged from sync. After a sync pull that drops the local error state, the feed SHALL remain governed by its learned-interval staleness check and SHALL be retried according to that check.

#### Scenario: Sync pull during backoff
- **WHEN** a sync pull applies a remote feed state while the local feed is in an error state
- **THEN** the error-backoff state is dropped on the merged record, and subsequent retries are governed by the learned-interval staleness check

### Requirement: Editing a feed's URL clears error state

The system SHALL clear a feed's error state when the user edits the feed's URL, so the new URL is not gated by backoff state accrued against the old URL.

#### Scenario: URL edited during backoff
- **WHEN** the user changes the URL of a feed whose error state has a pending `retryAt`
- **THEN** the error state is cleared and the feed is eligible for refresh at the next scheduler tick
