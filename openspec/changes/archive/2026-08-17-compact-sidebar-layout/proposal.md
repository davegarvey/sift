## Why

The sidebar wastes vertical space on two full-width action rows (Add feed, Refresh) and scrolls its section header and tag chips out of view, forcing scroll-to-top to switch tags when the feed list is long. Reclaiming that space and fixing the header makes the nav denser and filters always reachable.

## What Changes

- Collapse the Add feed and Refresh CTAs from full-width rows into compact icon buttons in the Feeds heading row.
- Make the feed list the only scrolling region: the Feeds heading, CTA icons, and tag chips stay fixed while feed names scroll.
- When there are no feeds, hide the icon CTAs in the heading; the only add-feed affordance is a prominent empty-state CTA in the feed list area ("Add your first feed").
- Refresh keeps its spinner state and disabled-while-refreshing behavior in its compact form.

## Capabilities

### New Capabilities
- `sidebar-layout`: Sidebar structure and scroll behavior — fixed zones (header, heading row with CTAs, tag chips, bottom actions), single scrolling feed list, and the empty-state add-feed treatment.

### Modified Capabilities
<!-- No existing specs are affected; `openspec/specs/` only contains `device-sync`. -->

## Impact

- `src/components/Sidebar.tsx` — restructure JSX: heading row with icon CTAs, dedicated scroll container for the feed list, conditional empty state.
- `src/styles.css` — sidebar zone layout, heading-row CTA styles, empty-state styles, touch sizing.
- No data-model, storage, or server changes.
