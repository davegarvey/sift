## Why

Sift's reading view uses a serif font for article body text, while the rest of the UI uses sans-serif. Established reading apps (Instapaper, Reeder, Pocket) let users choose their reading font. Adding this preference gives users control over their reading experience without imposing a single choice.

## What Changes

- Add a `readingFont` field (`'serif' | 'sans'`) to `AppSettings`, defaulting to `'serif'`
- Add a font selector (Serif / Sans-serif) to the Appearance section of the Settings drawer
- Expose a `--reading-font` CSS variable toggled dynamically so the reading view body, headings, and title switch fonts without affecting brand elements that use `--serif-stack`
- Persist the preference in IndexedDB alongside existing settings

## Capabilities

### New Capabilities
- `reading-font-preference`: Allow users to choose between serif and sans-serif font for article reading, stored persistently and applied immediately.

### Modified Capabilities

None.

## Impact

- `src/db/types.ts` — new `ReadingFont` type and `readingFont` field on `AppSettings`/`DEFAULT_SETTINGS`
- `src/styles.css` — new `--reading-font` variable; reading view selectors switch to use it
- `src/state.tsx` — export `applyReadingFont()`; call at boot and on preference change
- `src/components/SettingsDrawer.tsx` — font selector row in Appearance group
