## Context

Sift currently hardcodes `font-family: var(--serif-stack)` in the reading view CSS. The brand elements (sidebar wordmark, collapsed brand mark, mobile topbar wordmark) also use `--serif-stack`. Settings are persisted in IndexedDB via the existing `getSettings`/`saveSettings` path. There is no settings UI for reading font.

## Goals / Non-Goals

**Goals:**
- Users can choose between serif and sans-serif for article reading
- Preference is persisted across sessions in IndexedDB
- Preference applies immediately from Settings drawer (no page reload)
- Default is serif (preserving current experience for existing users)
- Brand elements (sidebar wordmark) remain in serif regardless of preference

**Non-Goals:**
- Font size or line-height preferences (future concern)
- Per-feed font overrides
- Custom font uploads or third-party webfonts

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New CSS variable vs toggling classes | New `--reading-font` CSS variable | Single source of truth; no class-name changes needed. Reading view selectors use `var(--reading-font)`, JS toggles the variable value. Brand elements keep referencing `var(--serif-stack)` directly and are unaffected. |
| Where to apply preference at boot | In `AppProvider` boot sequence, after `applyTheme()` | Follows existing pattern; settings are already loaded before feeds/items. |
| Where to apply on change | In the Settings drawer's change handler (optimistically), then persisted | Mirrors exact existing `setTheme` pattern — apply instantly, save async. |
| Preference storage | IndexedDB `meta` store, `'settings'` key | Reuses existing `getSettings`/`saveSettings` path. No new storage primitives. `getSettings()` merges with `DEFAULT_SETTINGS` so new field is safely backward-compatible. |

## Risks / Trade-offs

- [Backward compat] Persisted settings without the `readingFont` field get the default `'serif'` via object spread in `getSettings()` — no migration needed.
