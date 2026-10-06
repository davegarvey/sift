## Why

The hosted instance stores sync data for anyone who enables sync, but no route deletes it. Disabling sync clears the key in the browser and leaves server data in place; key rotation creates a new account and marks the old `users` row as rotated, leaving it and its rows in place; and the daily cron removes only tombstoned feeds, expired pairing codes, rate-limit rows and upstream metadata. Account data is therefore kept indefinitely. Under UK and EU GDPR a person can ask for their data to be erased, and storage limitation requires a defined retention period. The privacy policy in `public-site-pages` needs both before it can be published.

## What Changes

- Add an authenticated sync API operation that deletes the caller's account: the `users` row and all rows keyed by that sync key, including feeds, flags, feed statistics, agent tokens and pairing codes. The operation is idempotent and rate-limited like other sync writes.
- Remove the deleted account's feed URLs from polling. The poll registry is rebuilt daily from active accounts; deletion should also take effect immediately where practical, without deleting shared `polled_feeds` rows still needed by other accounts.
- Add a "Delete sync data" action to the settings drawer, behind a danger confirmation that states the effect on other paired devices. On success it disables sync locally and leaves local reading data untouched.
- Correct the disable-sync confirmation, which currently says server data is kept "until you generate a new key"; rotation does not delete it.
- Add retention to the daily cron, using the existing `users.last_active_at` and `users.rotated_at` columns: delete accounts with no sync activity for a fixed period (proposed: 12 months), and delete rotated-away accounts and their rows after a 30-day grace period.
- Keep deletion browser-only: `siftctl` needs no change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `device-sync`: account deletion, retention of inactive and rotated accounts, and the corrected disable-sync wording.
- `server-feed-polling`: removal of a deleted account's feeds from polling.

## Impact

`server/sync/routes.ts`, `server/sync/account.ts`, `server/sync/cron.ts`, `server/poll-registry.ts`, `server/sync/local-d1.ts`, migration `0010`, `src/sync/client.ts`, `src/sync/status.ts`, `src/components/SettingsDrawer.tsx`, the OpenAPI document in `public/openapi.json`, README and tests. No new dependencies.

## Decisions

- Inactive accounts are deleted after 12 months (365 days) without sync activity, measured from `last_active_at` and falling back to `created_at`. The privacy policy must state this period.
- Rotated-away accounts are deleted 30 days after rotation. Devices never adopt a rotated key automatically, so the period is a grace period before erasure and not a window for migration (see `design.md`).
- Devices that still hold a deleted key get no dedicated screen. They fail once with a clear message and stop automatic retries.
- `siftctl` is unchanged; deletion is browser-only.

## Non-goals

Export of server-side sync data (the browser already holds the same data and OPML export exists), administrator tooling for deleting other people's accounts, and changes to local IndexedDB eviction.
