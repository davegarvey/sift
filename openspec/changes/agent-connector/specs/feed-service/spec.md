## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: MCP handlers use context methods

**Reason**: The local MCP server and its SSE relay to the browser are removed. Agent writes now go to the sync database through the remote MCP endpoint, and devices receive them through sync.

**Migration**: None. Agents connect to `/mcp` with OAuth, as described in the `agent-connector` capability.
