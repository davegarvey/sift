# Change Proposal: Sidebar Empty State

## Why

When a user has zero feeds, the sidebar renders a full slate of controls that have nothing to act on: the `all` / starred filter chips are meaningless and the feed list area is blank. First-time users get no guidance in the sidebar itself.

## What Changes

- Hide the sidebar tag chips (`all`, starred) when there are no feeds.
- Show a muted "No feeds, yet." placeholder where the feed list would render when there are no feeds.
- Style the placeholder to match sidebar muted-text conventions.

## Capabilities

### New Capabilities
- `ui/sidebar-empty-state`: Sidebar presentation when the feed list is empty.

### Modified Capabilities
None.

## Impact

- `src/components/Sidebar.tsx` — conditionally render tag chips and feed list fallback.
- `src/styles.css` — add `.sidebar .feed-list-empty` rule.
