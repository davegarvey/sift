## Why

In the desktop reading workspace, the sidebar, article list and reader are shown side by side. The previous-article hit zone was fixed to the viewport's left edge, so it covered the first 56px of the sidebar and intercepted clicks and hover there. The "all" chip sits in that strip, which meant users could not reset tag or feed selections while reading.

## What Changes

- The previous-article hit zone starts at the reader pane's left edge rather than the viewport's.
- When the reader fills the viewport (focus mode, narrower layouts), the zone remains at the viewport edge, as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reader-nav-chevrons`: Desktop chevron hit zones are bounded by the reader pane and never overlap adjacent panes.

## Impact

- `src/components/ReadingView.tsx` publishes the reader pane's left offset as the `--reading-left` custom property.
- `src/styles.css` positions `.reading-zone-prev` from that offset.
- No API, storage schema, or dependency changes.
