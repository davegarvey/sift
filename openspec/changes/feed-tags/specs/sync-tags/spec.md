## ADDED Requirements

### Requirement: Sync feed tags across devices
Tags SHALL be synchronized across devices using the existing sync protocol. The `feed-upsert` dirty entry and `RemoteFeed` SHALL carry tags with timestamp-based conflict resolution.

#### Scenario: Tags included in feed-upsert dirty entry
- **WHEN** a feed is created or updated with tags
- **THEN** the `feed-upsert` dirty entry SHALL include `tags: string[] | null` and `tagsAt: number`

#### Scenario: Tags received from remote
- **WHEN** a remote push/pull delivers a `RemoteFeed` with a `tags` field
- **THEN** the local feed SHALL be merged using `newer()` with `remote.tags_at` vs local `feed.tagsAt`
- **THEN** if remote tags are newer, they SHALL replace local tags
- **THEN** `lastFetched` SHALL NOT be used as the comparison timestamp

#### Scenario: Tags survive server round-trip
- **WHEN** a feed with tags is synced to the server and pulled back
- **THEN** the tags SHALL be preserved identically

#### Scenario: Empty tags sync as null
- **WHEN** a feed has no tags
- **THEN** the dirty entry SHALL send `tags: null`
- **THEN** the server SHALL store and return `null`

#### Scenario: Null on remote does not clear local tags
- **WHEN** a remote feed arrives with `tags: null`
- **THEN** the local feed's tags SHALL be left unchanged
