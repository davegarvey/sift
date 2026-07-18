## Why

On mobile viewports (≤768px), the fixed-position TopBar (40px high, 44px on touch devices) overlays the top of the river (feed item list), obscuring the first item's content and action buttons. The river has no padding-top to account for the fixed bar.

## What Changes

- Add `padding-top: 40px` to `.river` inside the `@media (max-width: 768px)` block
- Add `padding-top: 44px` to `.river` inside the `@media (any-pointer: coarse)` block (touch-device override), where the TopBar is 44px tall

No functional changes, API changes, or new capabilities — pure CSS layout fix.

## Capabilities

### New Capabilities

None. This is a layout bug fix within existing capabilities.

### Modified Capabilities

None. No spec-level behavior changes.

## Impact

- **File changed**: `src/styles.css` — two additions, no removals
- No impact on desktop layout (TopBar is `display: none` above 768px)
- On desktop touch devices, the river will have 44px of top padding, which is barely noticeable and consistent with the existing pattern of applying touch-device overrides unconditionally
