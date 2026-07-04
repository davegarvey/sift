## Why

The current "high contrast" theme only tweaks `--subtext` slightly and removes opacity on read items — it's barely distinguishable from the standard Catppuccin theme. Users who select it for accessibility get negligible benefit. The Catppuccin palette is inherently low-contrast by design, so a meaningful high-contrast mode needs its own color palette.

## What Changes

- **Theme preference model** changes: `ThemePreference` drops the `'accessible'` value; high contrast becomes an orthogonal boolean toggle (`highContrast`) that can combine with any light/dark/system theme choice
- **High-contrast color palettes** for both light and dark modes, derived by pushing the existing Catppuccin hues to extreme contrast values (pure white / near-black backgrounds, near-black / pure white text)
- **CSS**: Replace the minimal `:root[data-a11y]` block with full color variable overrides for both light and dark high-contrast modes
- **UI**: Settings theme selector reduces to 3 options (system/light/dark); add a "High contrast" toggle
- **Persistence**: `highContrast` boolean saved alongside `theme` in IndexedDB settings

## Capabilities

### New Capabilities
- `high-contrast-theme`: High-contrast color palettes for light and dark modes, orthogonal to the main theme selection

### Modified Capabilities
*(None — no existing specs are changing)*

## Impact

- **`src/db/types.ts`**: `ThemePreference` narrowed to `'system' | 'light' | 'dark'`; `AppSettings` gains `highContrast: boolean`
- **`src/state.tsx`**: `applyTheme()` signature changes to accept `(theme, highContrast)`
- **`src/styles.css`**: New `:root[data-a11y]` and `:root[data-a11y][data-theme="dark"]` blocks with full variable overrides
- **`src/components/SettingsDrawer.tsx`**: Theme dropdown (3 options) + HC toggle
- **`src/settings.ts`**: No structural change — passes through new field automatically
