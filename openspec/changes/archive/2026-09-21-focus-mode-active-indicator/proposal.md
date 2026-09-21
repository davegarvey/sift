## Why

The focus-mode toggle changes behavior and its tooltip when enabled, but it has no persistent visual treatment to distinguish the active state at a glance. A resting-state highlight will make the current layout preference easier to recognize without changing the toggle's behavior.

## What Changes

- Keep the icon-only control and its existing state-dependent tooltip and accessible name.
- Add a persistent visual highlight while focus mode is enabled; return to the neutral idle style when disabled.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `desktop-reading-layout`: Require the focus-mode toggle to visibly indicate its enabled state.

## Impact

Updates the focus-mode toggle styling and the desktop-reading-layout behavior contract. No API, persisted data, or preference changes are required.
