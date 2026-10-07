## ADDED Requirements

### Requirement: Account deletion removes unshared polling state

When polling is enabled and an account is deleted through `DELETE /sync/account`, the server SHALL, after deleting the account, remove from the poll database every URL the account subscribed to (live or tombstoned) that no other live subscription in the sync database references, together with its `polled_feeds` row and its `polled_items` rows. A URL that another account still subscribes to SHALL keep its registry row and items. Failure of this step SHALL NOT fail the deletion; the daily maintenance pass, which rebuilds the registry from accounts that exist, are not rotated and have pulled within 14 days, SHALL then remove the URLs.

Accounts deleted by the daily retention cron SHALL NOT need this step: an account inactive for 365 days or rotated away has been outside the registry's 14-day window or rotated since before it was deleted, so its URLs have already left the registry and its items have already expired. Items of a URL removed by maintenance expire after 7 days as before.

#### Scenario: Feeds only the deleted account followed
- **WHEN** an account that was the only subscriber to a URL, including a private-feed URL with an embedded token, is deleted
- **THEN** the URL's `polled_feeds` and `polled_items` rows SHALL be deleted immediately

#### Scenario: Shared subscription
- **WHEN** an account is deleted and another account still has a live feed with the same URL
- **THEN** the registry row and items for that URL SHALL remain

#### Scenario: Other account's tombstone
- **WHEN** the only other row for a URL is a tombstoned feed of another account
- **THEN** the URL SHALL be removed with the deleted account's

#### Scenario: Immediate removal fails
- **WHEN** the poll database cannot be updated during an account deletion
- **THEN** the deletion SHALL still return `204`
- **AND** the next maintenance pass SHALL remove the URLs that no remaining account wants

#### Scenario: Poll database not bound
- **WHEN** polling is disabled for the deployment
- **THEN** account deletion SHALL NOT touch any poll database
