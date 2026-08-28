## Why

The stats help control currently sits independently at the top of the page and forces extra top padding on mobile to make room for its absolute position. Placing it alongside the Stats kicker keeps the page heading compact without reducing access to the explanation.

## What Changes

- Place the help CTA on the same row as the Stats kicker across responsive layouts.
- Anchor the definitions panel to the help control without changing its content or interaction behavior.
- Remove the mobile-only heading spacer that exists solely for the current absolute placement.
- Preserve keyboard focus, outside-click dismissal, Escape handling, and responsive panel sizing.

## Capabilities

### New Capabilities

- `stats-help-layout`: Compact responsive placement of the stats help CTA and its explanation panel.

### Modified Capabilities

## Impact

- Stats heading markup and responsive CSS.
- Stats view layout coverage.
- No data, routing, sync, or dependency changes.
