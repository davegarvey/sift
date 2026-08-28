## Why

The stats view's separate sort select hides the relationship between each ordering choice and the table data, and its lifetime backlog option is easy to confuse with current unread state. Sortable column headings make the available metrics discoverable while allowing users to choose either direction and return to their preferred order on later visits.

## What Changes

- Replace the desktop stats sort select with sortable table column headings.
- Allow each sortable heading to toggle ascending and descending order, with a visible indicator on the active heading.
- Sort the feed name alphabetically and sort the numeric stats columns by their displayed metric.
- Keep unavailable derived values after numeric values in either direction and use deterministic feed-title tie-breaking.
- Provide a compact mobile sorting fallback because the responsive stats layout does not display the desktop table headings.
- Remember the selected column and direction in local application settings; do not sync this presentation preference between devices.
- Remove the separate lifetime-backlog sort option rather than exposing a sort key that is not represented by a table column.

## Capabilities

### New Capabilities

- `stats-column-sorting`: Sort stats by visible column headings in either direction and persist the local presentation choice.

### Modified Capabilities

<!-- The existing feed-reading-stats change is not an archived main capability, so this follow-up defines the interaction contract separately. -->

## Impact

- Stats table markup, sorting service, responsive styles, and stats view tests.
- Local `AppSettings` persistence and its default hydration path.
- No server, sync protocol, database migration, or third-party dependency changes.
