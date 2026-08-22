## ADDED Requirements

### Requirement: Feed subscription service
The system SHALL provide a `subscribeFeed` function in `src/feeds/service.ts` that atomically writes a feed to the local IndexedDB feed store and enqueues a `feed-upsert` entry in the sync dirty queue. The function SHALL also schedule a flush so the change is pushed to the sync server within the debounce window.

#### Scenario: Subscribing a feed writes to IDB and enqueues
- **WHEN** `subscribeFeed({ url, title })` is called
- **THEN** the feed is persisted to the local `feeds` IDB store with `lastFetched: null`
- **AND** a `feed-upsert` entry is appended to the sync dirty queue with `feedUrl` set to the provided URL
- **AND** a sync flush is scheduled

#### Scenario: Subscribing a feed with optional folder
- **WHEN** `subscribeFeed({ url, title, folder: ['Tech'] })` is called
- **THEN** the enqueued `feed-upsert` entry includes `folder: ['Tech']` and `folderAt: <timestamp>`

#### Scenario: Subscribing without folder stores null folder
- **WHEN** `subscribeFeed({ url, title })` is called without a `folder` argument
- **THEN** the enqueued `feed-upsert` entry has `folder: null`

### Requirement: Feed unsubscription service
The system SHALL provide an `unsubscribeFeed` function in `src/feeds/service.ts` that atomically deletes a feed (and its items) from the local IndexedDB and enqueues a `feed-delete` entry in the sync dirty queue. The function SHALL also schedule a flush.

#### Scenario: Unsubscribing a feed deletes from IDB and enqueues
- **WHEN** `unsubscribeFeed(url)` is called
- **THEN** the feed and its items are removed from local IDB
- **AND** a `feed-delete` entry is appended to the sync dirty queue with `feedUrl` set to the provided URL
- **AND** a sync flush is scheduled

### Requirement: AppContext subscribe/unsubscribe wrappers
The system SHALL expose `subscribeFeed` and `unsubscribeFeed` methods on the `AppContext` returned by `useApp()`. These methods SHALL delegate to the service-layer functions and additionally refresh the `feeds` and `items` signals so the UI reflects the change immediately. The `unsubscribeFeed` context method SHALL also reset `riverScope` to `null` if the unsubscribed feed was the current scope.

#### Scenario: UI subscribe refreshes signals
- **WHEN** a UI component calls `ctx.subscribeFeed({ url, title })`
- **THEN** the `feeds()` signal returns the new feed
- **AND** the service-layer enqueue has been performed

#### Scenario: UI unsubscribe refreshes signals and clears scope
- **WHEN** a UI component calls `ctx.unsubscribeFeed(url)` while `state.riverScope === url`
- **THEN** the `feeds()` signal no longer contains the unsubscribed feed
- **AND** `state.riverScope` is set to `null`

#### Scenario: UI unsubscribe does not clear scope when not in scope
- **WHEN** a UI component calls `ctx.unsubscribeFeed(url)` while `state.riverScope !== url`
- **THEN** the `feeds()` signal no longer contains the unsubscribed feed
- **AND** `state.riverScope` is unchanged

### Requirement: OPML import uses the service
`src/opml/merge.ts` SHALL use `subscribeFeed` from the service layer for each new subscription rather than calling `upsertFeed` directly. This ensures OPML-imported feeds are enqueued for sync.

#### Scenario: OPML import enqueues each new feed
- **WHEN** `applyMerge(preview)` is called with a preview containing multiple new subscriptions
- **THEN** each new subscription is written to local IDB
- **AND** a `feed-upsert` entry is enqueued for each new subscription

### Requirement: UI components use context methods
`AddFeedModal` SHALL call `ctx.subscribeFeed` for the initial feed write, and `ConfirmUnsubscribeModal` SHALL call `ctx.unsubscribeFeed`. Neither component SHALL import `upsertFeed` or `unsubscribeFeed` from `src/db/feeds.ts` for the subscription/unsubscription operation.

#### Scenario: AddFeedModal subscribes via context
- **WHEN** the user confirms subscription in `AddFeedModal`
- **THEN** `ctx.subscribeFeed` is called
- **AND** the change is enqueued for sync

#### Scenario: ConfirmUnsubscribeModal unsubscribes via context
- **WHEN** the user confirms unsubscription in `ConfirmUnsubscribeModal`
- **THEN** `ctx.unsubscribeFeed` is called
- **AND** the change is enqueued for sync
- **AND** `mcpNotifySync` is called for MCP server notification

### Requirement: MCP handlers use context methods
The MCP `add-feed` and `remove-feed` EventSource handlers in `src/state.tsx` SHALL use `ctx.subscribeFeed` and `ctx.unsubscribeFeed` respectively, rather than composing the operations inline.

#### Scenario: MCP add-feed uses context
- **WHEN** the MCP server sends an `add-feed` event
- **THEN** `ctx.subscribeFeed` is called with the feed from the event
- **AND** the MCP server is acked

#### Scenario: MCP remove-feed uses context and refreshes items
- **WHEN** the MCP server sends a `remove-feed` event
- **THEN** `ctx.unsubscribeFeed` is called with the URL from the event
- **AND** the `items()` signal is refreshed so any open river view updates immediately
- **AND** the MCP server is acked

### Requirement: QR-paired device shows feeds immediately
When the app boots with a `?pair=` URL parameter, after `triggerFirstTime()` completes, the `feeds()` and `items()` signals SHALL be refreshed so the newly-pulled feeds appear in the river view without waiting for the 30-second reload interval.

#### Scenario: First-visit QR pairing refreshes signals
- **WHEN** the app boots with `?pair=<code>` and the pairing succeeds
- **THEN** `triggerFirstTime()` runs and pulls the source device's feeds
- **AND** `reloadFeeds()` and `reloadItems()` are called
- **AND** the `feeds()` signal reflects the pulled feeds

### Requirement: Subsequent reloads complete sync before first render
On app boot (any visit, with or without `?pair=`), `bootSync()` SHALL be awaited before the initial signal reads complete, so the first paint of the river view reflects the latest server state.

#### Scenario: Reload with existing sync key awaits boot
- **WHEN** the app boots with a stored sync key
- **THEN** `bootSync()` completes before `reloadFeeds()` runs
- **AND** the first paint of the river view reflects the latest server-pulled state

### Requirement: Sync queue regression test
A test SHALL exist that asserts `subscribeFeed` appends a `feed-upsert` entry to the sync dirty queue and `unsubscribeFeed` appends a `feed-delete` entry. The test SHALL fail if either function omits the enqueue step.

#### Scenario: subscribeFeed enqueues feed-upsert
- **WHEN** `subscribeFeed({ url: 'https://example.com/feed', title: 'Example' })` is called
- **THEN** `getDirty()` contains a `feed-upsert` entry with `feedUrl: 'https://example.com/feed'`

#### Scenario: unsubscribeFeed enqueues feed-delete
- **WHEN** `unsubscribeFeed('https://example.com/feed')` is called
- **THEN** `getDirty()` contains a `feed-delete` entry with `feedUrl: 'https://example.com/feed'`
