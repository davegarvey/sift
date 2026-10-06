## ADDED Requirements

### Requirement: Authenticated account deletion

The server SHALL provide `DELETE /sync/account`, authenticated with the master sync key, that deletes the caller's account: the `users` row and every row keyed by that sync key in `feeds`, `flags`, `feed_stats`, `tokens` and `pairing_codes` (device and agent codes), and the `rate_limits` rows whose scope embeds the key. The deletes SHALL run in one atomic batch and the route SHALL respond `204`. Agent tokens, agent pairing codes and the master key SHALL be rejected on the next request. Rows that are not keyed by a sync key (`counters`, `feed_fetch_failures`, `upstream_origin_policy`) SHALL NOT be changed. Agent tokens SHALL be rejected with `401` on this route.

The route SHALL be rate-limited per sync key (10 requests per hour) before any data is changed. A repeat request with a key that has been deleted SHALL change no data and SHALL be rejected with `401`, as for any key the server does not know. The server SHALL NOT log the key or any deleted row.

#### Scenario: Account deleted
- **WHEN** a client calls `DELETE /sync/account` with a valid master key
- **THEN** the server SHALL respond `204`
- **AND** no row in `users`, `feeds`, `flags`, `feed_stats`, `tokens` or `pairing_codes` SHALL remain for that key
- **AND** no `rate_limits` row SHALL remain whose scope is a route prefix followed by that key

#### Scenario: Other accounts untouched
- **WHEN** one account is deleted
- **THEN** every row belonging to other accounts SHALL be unchanged
- **AND** the other accounts SHALL continue to sync

#### Scenario: Agent access revoked
- **WHEN** an account with an agent token and an unexpired agent pairing code is deleted
- **THEN** the token SHALL receive `401` on `/sync/pull` and `/sync/push`
- **AND** the pairing code SHALL no longer authorise `/sync/pull`

#### Scenario: Repeat deletion
- **WHEN** a client repeats `DELETE /sync/account` with a key that was already deleted
- **THEN** the server SHALL respond `401`
- **AND** SHALL change no data

#### Scenario: Unauthenticated or token request
- **WHEN** the request has no key, a malformed key, an unknown key or an agent token
- **THEN** the server SHALL respond `401`
- **AND** SHALL NOT delete any data

#### Scenario: Rate limited
- **WHEN** more than 10 requests for the same sync key arrive within an hour
- **THEN** the server SHALL respond `429` with a `Retry-After` header
- **AND** SHALL NOT delete any data

### Requirement: Pull records account activity

`GET /sync/pull` SHALL record the time of the pull in `users.last_active_at` (epoch seconds) at most once per hour for the authenticated account, whether or not server feed polling is enabled. A pull authenticated by an agent token or an agent pairing code SHALL count as activity for the account it belongs to. Other routes SHALL NOT record activity.

#### Scenario: Pull without polling
- **WHEN** an account pulls on a deployment where polling is disabled
- **THEN** its `last_active_at` SHALL be set

#### Scenario: Recent activity is not rewritten
- **WHEN** an account pulls again within an hour of its recorded activity
- **THEN** `last_active_at` SHALL be unchanged

### Requirement: Retention of rotated and inactive accounts

The daily cron SHALL delete, with the rows account deletion covers, each account that was rotated away (`rotated_at`) more than 30 days ago and each account that has had no sync activity for 365 days. Inactivity SHALL be measured from `last_active_at`, or from `created_at` when `last_active_at` is null. A rotated account SHALL be handled only by the rotation rule. `rate_limits` rows SHALL be left to the cron's existing 24-hour cleanup, which runs first. Each account SHALL be deleted in its own atomic batch, and one run SHALL delete at most 50 accounts, rotated accounts first; later runs SHALL delete the remainder. A failure to delete one account SHALL NOT stop the run from attempting the others.

Rotation never moves data and rejects the old key at once, so a device adopts the new key only by pairing again with a code from a device that holds it, and nothing reads the old rows. The 30-day period is a grace period before erasure, not a window for devices to adopt the new key.

#### Scenario: Inactive account
- **WHEN** the cron runs and an account's last activity was 366 days ago
- **THEN** the account and its rows SHALL be deleted

#### Scenario: Account active within a year
- **WHEN** an account was last active 330 days ago, or was created long ago and pulled 5 days ago
- **THEN** it SHALL NOT be deleted

#### Scenario: Never active
- **WHEN** an account has no recorded activity and was created 400 days ago
- **THEN** it SHALL be deleted
- **AND** an account with no recorded activity created 10 days ago SHALL NOT be deleted

#### Scenario: Rotated account past the grace period
- **WHEN** an account was rotated away 31 days ago
- **THEN** the cron SHALL delete it and its feeds, flags, statistics, agent tokens and pairing codes, whatever its last activity
- **AND** the account that replaced it SHALL be unchanged

#### Scenario: Rotated account within the grace period
- **WHEN** an account was rotated away 29 days ago
- **THEN** it SHALL NOT be deleted

#### Scenario: Backlog
- **WHEN** more than 50 accounts are due for deletion
- **THEN** one run SHALL delete 50 of them
- **AND** later runs SHALL delete the rest

### Requirement: A rejected sync key is not retried

When a sync request receives `401`, the client SHALL fail that request once, without retrying it, with the message "The server no longer recognises this sync key. Pair this device again, or turn sync off." It SHALL record the message as the last sync error and show it in the Sync section of Settings. Until a sync request succeeds or sync is disabled, the client SHALL NOT start focus, online or visibility pulls or debounced pushes; an explicit action (Sync now, a manual refresh) SHALL still try once. Changes made meanwhile SHALL stay queued. Disabling sync SHALL clear the recorded error.

#### Scenario: Account deleted on another device
- **WHEN** a paired device syncs after another device deleted the account
- **THEN** the pull SHALL fail once with the message above
- **AND** the Sync section SHALL show the message
- **AND** no further automatic request SHALL be sent

#### Scenario: Explicit retry
- **WHEN** the user chooses Sync now while the key is rejected
- **THEN** the client SHALL send one request
- **AND** if it succeeds, automatic syncing SHALL resume

#### Scenario: Local changes while rejected
- **WHEN** the user marks items read while the key is rejected
- **THEN** the changes SHALL remain in the dirty set
- **AND** no push SHALL be sent

### Requirement: Delete sync data from Settings

When sync is enabled, the Sync section of Settings SHALL offer a "Delete sync data" action behind a danger confirmation. The confirmation SHALL state that the synced subscriptions, flags, statistics and agent access are deleted from the server, that other paired devices will stop syncing, and that reading data on this device is kept. On confirmation the client SHALL call `DELETE /sync/account` and, when it succeeds, call `disableSync()`. A `401` response SHALL count as success, because the server no longer holds the account. Any other failure SHALL leave sync enabled and show "Failed to delete sync data. Try again." Local feeds, items, flags and statistics SHALL NOT be changed.

#### Scenario: Deletion confirmed
- **WHEN** the user confirms Delete sync data
- **THEN** the client SHALL send `DELETE /sync/account` with the stored key
- **AND** on success SHALL disable sync locally
- **AND** SHALL NOT remove any local feed, item or flag

#### Scenario: Deletion cancelled
- **WHEN** the user cancels the confirmation
- **THEN** no request SHALL be sent
- **AND** sync SHALL remain enabled

#### Scenario: Server error
- **WHEN** the server answers `500` or `429`
- **THEN** sync SHALL remain enabled
- **AND** the Sync section SHALL show the error

#### Scenario: Re-enabling after deletion
- **WHEN** the user enables sync after deleting sync data
- **THEN** a new sync key SHALL be generated and registered

## MODIFIED Requirements

### Requirement: Sync status UI in Settings

The Settings panel SHALL include a Sync section, conditionally rendered when the server reports that sync is available via `GET /sync/capabilities`.

#### Scenario: Sync section is hidden when server has no D1 binding
- **WHEN** `GET /sync/capabilities` returns 404 or a body lacking `sync: true`
- **THEN** the Sync section SHALL NOT be rendered in Settings
- **AND** the capability check SHALL be performed on each page load (not cached across reloads)

#### Scenario: Sync-on state displays key and status
- **WHEN** sync is enabled
- **THEN** the Settings panel SHALL display, in order: a status line (last sync activity plus the display-only 4-character group fingerprint, with no copy affordance), a "Sync now" action, a "Pair another device" row that opens the unified pairing modal in source mode, an "Agent access" row that opens the agents modal, a separated "Regenerate" row, and a "Delete sync data" row
- **AND** the group fingerprint SHALL be derived one-way from the sync key and SHALL NOT be used by any pairing flow
- **AND** the status line SHALL show the last error with its relative time when the last sync failed, the pending change count when changes are waiting, "Never synced" when no sync has ever succeeded, and otherwise the relative time of the last successful sync

#### Scenario: Last synced updates while drawer is open
- **WHEN** the Settings drawer is open
- **THEN** the status line's relative time SHALL be recomputed every 30 seconds

#### Scenario: Sync-off state displays the enable flow
- **WHEN** sync is disabled
- **THEN** the Settings panel SHALL display an "Enable sync" toggle that generates a key and expands the Sync section to the sync-on state
- **AND** SHALL display a "Join an existing sync" row that opens the unified pairing modal in receiving mode

#### Scenario: Disabling sync requires confirmation
- **WHEN** the user toggles sync off while it is currently enabled
- **THEN** the system SHALL display a confirm dialog stating that this device will stop syncing, that the synced data stays on the server and that devices paired with the same key keep syncing
- **AND** the dialog SHALL tell the user to cancel and use "Delete sync data" first if they want the server data deleted, because this device no longer holds the key afterwards
- **AND** the dialog SHALL NOT say that generating a new key keeps or removes the server data
- **AND** SHALL only clear the local sync key and the dirty set on explicit confirmation
