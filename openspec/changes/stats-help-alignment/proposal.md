## Why

The stats help CTA now shares a row with the Stats kicker, but that row is still constrained to the header copy width. As a result, the CTA stops short of the right edge used by the summary and feed table, making the page feel visually misaligned.

## What Changes

- Extend the stats heading row to the full content boundary used by the summary and feed table.
- Keep the title and descriptive copy at their existing readable widths.
- Right-align the help CTA with the other stats components on desktop and mobile.
- Preserve the existing help panel position, focus behavior, and dismissal interactions.

## Capabilities

### New Capabilities

### Modified Capabilities

- `stats-help-layout`: Align the shared kicker/help row with the full stats content boundary.

## Impact

- Stats heading CSS and layout coverage.
- No data, routing, sync, or dependency changes.
