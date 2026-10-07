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

### Requirement: Regeneration rotates the key and preserves local state

Regenerating the sync key (without disabling sync) SHALL preserve the local dirty set and `lastSyncAt`. The user wants continuity of state across the regeneration. The client SHALL store the new key locally and then call `POST /sync/rotate` with the old key in the `X-Sync-Key` header and the new key in the body. The server registers the new key and marks the old key's account rotated in one batch. A `401` is never recovered by registering: a key the server rejects stays rejected, and the client handles it as defined by the requirement "A rejected sync key is not retried".

#### Scenario: User regenerates the key
- **WHEN** the user clicks "Regenerate" and confirms
- **THEN** the system SHALL generate a new sync key
- **AND** SHALL replace the local sync key
- **AND** SHALL preserve the dirty set
- **AND** SHALL preserve `lastSyncAt`
- **AND** SHALL call `POST /sync/rotate`, which registers the new key and rotates the old one, so that the next push or pull with the new key is authenticated

#### Scenario: Rotation request fails
- **WHEN** the user regenerates the key and `POST /sync/rotate` fails
- **THEN** the new key SHALL remain stored locally and the failure SHALL be logged with `console.error`
- **AND** the new key SHALL NOT be registered by any automatic retry
- **AND** the next sync request SHALL receive `401` and SHALL be handled as a rejected sync key

#### Scenario: 401 is not auto-registered
- **WHEN** the server returns `401` for a sync request
- **THEN** the client SHALL NOT call `POST /sync/register` and SHALL NOT retry the request
- **AND** the only client paths that register a key are enabling sync, pairing, issuing a pairing code and rotation, each an explicit user action

### Requirement: Rotation revokes a lost or stolen device's key

The system SHALL provide no key revocation other than rotation. The only remediation for a stolen device is to regenerate the key on a trusted device and pair the other devices again. Rotation SHALL take effect at once: the server SHALL reject the old key and every agent token minted under it with `401`, and `POST /sync/register` SHALL refuse to register the old key while its rotated account exists (`403`). Rotation does not move data; the old account's rows stay on the server, unreadable through the API, until the daily cron deletes them 30 days after rotation.

#### Scenario: User regenerates key after device loss
- **WHEN** the user opens Settings on a trusted device
- **AND** clicks "Regenerate" and confirms
- **THEN** a new sync key SHALL be generated
- **AND** the new key SHALL be stored locally and registered on the server
- **AND** no data SHALL be migrated from the old account to the new one on the server

#### Scenario: Stolen device's key is rejected after rotation
- **WHEN** a stolen device presents the previous sync key after rotation
- **THEN** the server SHALL respond `401` to push, pull and every other authenticated route
- **AND** agent tokens minted under the old key SHALL be rejected with `401`
- **AND** the Settings UI SHALL state, on the regenerate confirmation, that regenerating the key is the only way to revoke a lost or stolen device's access

#### Scenario: Old account is erased after the grace period
- **WHEN** 30 days have passed since the rotation
- **THEN** the daily cron SHALL delete the old account and its rows, as defined by the requirement "Retention of rotated and inactive accounts"

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

## REMOVED Requirements

### Requirement: Regenerate preserves dirty set
**Reason**: It required the client to register the new key lazily and to auto-register on a 401. The client does neither: `POST /sync/rotate` registers the new key, and a 401 is final. Replaced by "Regeneration rotates the key and preserves local state".
**Migration**: None; the behaviour already shipped. Preserving the dirty set and `lastSyncAt` is retained in the replacement.

### Requirement: Stolen device recovery via key regeneration
**Reason**: It said the server keeps accepting the old key and orphans its data. Since rotation shipped, the server rejects the old key and its agent tokens at once, and the old data is now deleted after 30 days. Replaced by "Rotation revokes a lost or stolen device's key".
**Migration**: None; the behaviour already shipped.
