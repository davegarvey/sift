## MODIFIED Requirements

### Requirement: Server stores only sync-relevant data

The server SHALL store exactly the data needed for sync, partitioned by sync key. The server SHALL NOT store article content, thumbnails, settings, or feed-fetching metadata on behalf of a sync key. When server feed polling is enabled for the deployment, the server MAY additionally store retained feed items and polling state keyed by feed URL, as defined by the `server-feed-polling` capability; these rows SHALL NOT be partitioned by or contain a sync key.

#### Scenario: Feed subscription stored
- **WHEN** a client pushes a feed subscription
- **THEN** the server SHALL store the feed URL, the folder path (or null for root), the title, the deleted-tombstone flag, and per-field timestamps

#### Scenario: Read flag stored
- **WHEN** a client pushes a flag update
- **THEN** the server SHALL store the item ID, the feed URL (denormalized), the read value (1, 0, or null), the starred value (1, 0, or null), and per-field timestamps

#### Scenario: Article content is never stored
- **WHEN** any client request is processed
- **THEN** the server SHALL NOT receive or store article HTML, extracted content, thumbnails, or feed XML bodies sent by the client

#### Scenario: Polling disabled
- **WHEN** server feed polling is not enabled for the deployment
- **THEN** the server SHALL NOT store feed items, thumbnails or feed HTML
