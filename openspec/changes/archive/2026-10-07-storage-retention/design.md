# Design: storage retention

## Context

The item body store added by `split-item-bodies` separates the large HTML fields from article metadata. This change uses that split to reduce long-term local storage while preserving the small records that power search, unread lists and reading history.

## Decisions

- Store `lastSeenAt` on each item and index it. A successful feed parse and every sync item pull refresh the timestamp, including pulls that do not replace a device's existing item.
- Version 11 migrates version 10 in place. Existing items receive the migration timestamp so the first release cannot immediately age out the whole library. Version 9 upgrades apply the existing body split and the new timestamp migration in the same version change.
- Each refresh sweep scans at most 500 old records for body cleanup and 500 for unread-record cleanup. Per-pass continuation keys in IndexedDB meta rotate through older records without repeatedly scanning the same starred or read records. Unstarred bodies expire at 90 days; unstarred unread records expire at 365 days. Read and starred records remain.
- Deleting an unread record also removes its body, current flag and read marker. Lifetime aggregate statistics remain unchanged.
- Request persistent storage once after the first feed is added. Store the request outcome marker so later subscriptions do not prompt again; Settings allows an explicit retry.
- Settings reads quota, usage, persistence state, item count and body count from the browser. Failure or lack of API support is shown as unavailable and does not prevent retention.

## Risks

- A reader may want an article after its body expires. The article record and link remain; reopening online can fetch and extract the page again.
- Migration stamps existing items at one time, delaying cleanup until a full period after the upgrade. This protects existing libraries from abrupt deletion.
- Browser storage estimates are approximate. They describe the current origin and are informational rather than a retention trigger.
- Persistent storage requests may be denied or unsupported. Retention still limits growth; the app does not promise the browser will preserve origin data indefinitely.
