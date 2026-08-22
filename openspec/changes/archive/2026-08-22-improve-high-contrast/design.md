## Context

Sift uses Catppuccin Latte (light) and Mocha (dark) as its default themes. The current "high contrast" (`data-a11y`) mode only overrides `--subtext` slightly and removes opacity on read items — negligible improvement over the standard theme. Users who select it for accessibility get little benefit.

The proposal splits theme selection from high contrast: theme becomes `system | light | dark` (3-way), and high contrast becomes an orthogonal toggle. When enabled, a separate high-contrast palette replaces all color variables while keeping the same structural layout.

## Goals / Non-Goals

**Goals:**
- Every text/background pair in HC mode passes WCAG AA (4.5:1 for small text)
- Most pairs pass WCAG AAA (7:1)
- Orthogonal HC toggle works with any theme choice (system/light/dark) and persists to IndexedDB
- Keep the same Catppuccin mauve accent for brand consistency
- Current default themes are untouched

**Non-Goals:**
- No structural layout changes
- No new UI components
- No changes to font stacks or spacing
- No changes to the non-HC themes

## Decisions

### Decision: Orthogonal toggle vs 4-way selector

Current model is a 4-way `<select>`: system / light / dark / accessible. This forces a choice between "follow system but not high contrast" vs "high contrast but can't follow system."

**Chosen**: Separate theme selector (system/light/dark) + "High contrast" toggle. This allows any combination (system+HC, light+HC, dark+HC, system no HC, etc.).

### Decision: CSS attribute strategy

When HC is on AND a specific theme is chosen → set both `data-a11y` and `data-theme` on `<html>`.
When HC is on AND theme is system → set only `data-a11y` (the `@media (prefers-color-scheme: dark)` query picks the right HC variant).

CSS cascade:
```
:root[data-a11y]                              → HC light (default)
:root[data-a11y][data-theme="dark"]           → HC dark (explicit)
@media (prefers-color-scheme: dark) {
  :root[data-a11y]:not([data-theme="light"])  → HC dark (system follow)
}
```

### Decision: Push Catppuccin hues vs use an unrelated palette

Alternatives considered: GitHub Primer, Bluloco, Atom One. These are well-tested accessible palettes but would introduce a completely different visual identity for HC mode.

**Chosen**: Push the existing Catppuccin hues to extreme contrast values. Keeps the same mauve accent and general color temperature, so HC mode feels like "the same app, but readable" rather than "a different app."

### Finalized color values

```
Light HC:
  --base:         #ffffff        (pure white)
  --mantle:       #f4f5f8
  --surface:      #eaecf1
  --text:         #171825        (near-black)
  --subtext:      #464861
  --overlay:      #707387
  --crust:        #e2e4ec
  --accent:       #8839ef        (unchanged mauve)
  --accent-dim:   rgba(136, 57, 239, 0.20)
  --accent-text:  #6400c8        (unchanged)
  --hairline:     rgba(23, 24, 37, 0.15)

Dark HC:
  --base:         #0b0b14        (near-black)
  --mantle:       #12121e
  --surface:      #1c1c2e
  --text:         #eef0fa        (near-white)
  --subtext:      #b6bcd6
  --overlay:      #8084a4
  --crust:        #0e0e1a
  --accent:       #cba6f7        (unchanged mauve)
  --accent-dim:   rgba(203, 166, 247, 0.28)
  --accent-text:  #f5c2e7        (unchanged)
  --hairline:     rgba(238, 240, 250, 0.12)
```

Contrast verification (all AA+, most AAA):

| Pair | Current Light | HC Light | Current Dark | HC Dark |
|---|---|---|---|---|
| text on base | 7.1:1 AAA | 17.6:1 AAA | 11.3:1 AAA | 17.2:1 AAA |
| subtext on base | 4.4:1 AA-lg | 8.9:1 AAA | 7.4:1 AAA | 10.4:1 AAA |
| overlay on base | 1.6:1 FAIL | 4.7:1 AA | 3.4:1 AA-lg | 5.4:1 AA |
| accent on base | 4.8:1 AA | 5.4:1 AA | 8.1:1 AAA | 9.6:1 AAA |

## Risks / Trade-offs

- **HC light `--accent` is only 5.4:1 (AA)** — the Catppuccin mauve has an inherent ceiling against white. To get AAA on accent we'd need a darker purple, which changes the brand color. Acceptable trade-off for an AA pass on interactive elements.
- **Pure white `--base` in HC light** may feel harsh to some users — but that's the nature of high contrast mode. Users who want softer whites can use the default light theme.
- **Near-black `--base` in HC dark** (#0b0b14) isn't pure black, so OLED power savings aren't maximized. Pure black (`#000`) looked too stark against the colored elements. Kept the very slight blue tint of Catppuccin's palette.

## Migration Plan

No migration needed — the `'accessible'` value in `ThemePreference` is removed but persisted settings with that value will gracefully fall back to `'system'` via the DEFAULT_SETTINGS merge in `getSettings()`. No rolling back existing data.

## Open Questions

None resolved.
