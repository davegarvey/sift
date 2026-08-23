## Why

Manual refresh currently fetches every subscribed feed even when the user is viewing one feed or a tag-scoped group. This creates unnecessary upstream requests and makes the existing feed and tag selection less useful as a way to control refresh scope.

## What Changes

- Make every ordinary manual refresh action refresh only the current selection.
- Refresh the single feed when a feed scope is active.
- Refresh all feeds matching any active tag when a tag scope is active.
- Preserve the existing all-feeds behavior when the All view is selected.
- Snapshot the concrete feed IDs at the start of the manual action so sync changes cannot expand or shrink that action's target midway through.
- Keep background and scheduled refresh global, subject to their existing stale-feed rules.
- Keep OPML import as a special case that explicitly refreshes every imported feed.
- Keep background fetching from disabling or spinning the manual refresh CTA.
- Serialize overlapping manual refresh actions and coalesce repeated keyboard/button triggers.
- Update refresh action labels and accessible names so they describe the current scope instead of always saying “Refresh all feeds.”
- Preserve the existing sync pull and final feed/item reload behavior around manual refresh.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `event-driven-refresh`: manual refresh targets the current feed or tag selection while retaining callback suppression and reload guarantees.
- `refresh-feedback`: immediate feedback applies to scoped manual refresh actions, with labels that identify the selected scope.
- `sidebar-layout`: the sidebar refresh action refreshes the current selection rather than unconditionally refreshing every feed.
- `feed-service`: OPML import explicitly performs a full refresh of newly imported feeds, regardless of the current UI selection.

## Impact

- Update refresh scope derivation and manual refresh orchestration in `src/state.tsx`.
- Extend the feed scheduler API in `src/feeds/scheduler.ts` to accept an explicit manual target set without changing background callers.
- Update refresh labels and all manual refresh entry points in the sidebar, command palette, keyboard handling, empty state, and OPML import flow.
- Add scheduler and selection-behavior coverage; no new dependencies or server changes are required.
