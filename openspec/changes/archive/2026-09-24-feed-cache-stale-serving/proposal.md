## Why

The shared `/feed` cache is meant to make upstream load independent of the number of Sift users. In production it does not: any upstream response carrying `Set-Cookie` bypasses the cache, and many large publishers (Reddit, The Guardian) set cookies on every feed response. Every client refresh of those feeds reaches the origin, which quickly produces `429` responses. When a limit is hit, the proxy returns the failure to every client for the length of the cooldown even though it holds a recent copy of the feed, and the client marks the feed with an error for a condition that needs no user action.

## What Changes

- Cache successful feed responses regardless of `Set-Cookie` or `Vary: *`. The proxy never forwards upstream cookies and sends no user credentials, so the representation is not personalised.
- Derive each representation's freshness from the longer of Sift's 15-minute floor and the upstream's own hints (`Cache-Control` `s-maxage`/`max-age`, `Expires`, RSS `<ttl>`, `sy:updatePeriod`/`sy:updateFrequency`), capped at 24 hours.
- Retain each representation for 24 hours after it becomes stale and serve it, marked `X-Sift-Cache: stale`, while the upstream is rate limiting, challenging, timing out or failing with a server error.
- The client treats transient failures as quiet when the feed has been received within the last 24 hours, keeping the sidebar warning for persistent or non-transient failures.
- The feed editor shows when the server last received the feed and, when the server is waiting on the upstream, when it will next check.

## Capabilities

### New Capabilities

- `feed-refresh-status`: How refresh state and failures are presented in the client.

### Modified Capabilities

- `shared-feed-cache`: Cookie-setting responses are cacheable; freshness follows upstream hints; retained representations are served during transient failures.
- `cloudflare-feed-cache`: Worker Cache API entries carry a freshness time and a retention window instead of a fixed 15-minute lifetime.
- `shared-feed-failure-cooldown`: Requests during a transient cooldown receive the retained representation when one exists.

## Impact

- `server/fetch.ts`, `server/handle.ts`: freshness, retention and stale serving.
- `src/feeds/fetch.ts`, `src/feeds/scheduler.ts`, `src/db/types.ts`, `src/sync/apply.ts`: new local-only feed fields and error visibility.
- `src/components/FeedEditorModal.tsx`: one line of refresh status.
- No new dependencies, bindings or migrations. Feed bodies remain outside D1.
