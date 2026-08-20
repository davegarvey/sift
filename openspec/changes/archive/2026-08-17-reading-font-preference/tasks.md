## 1. Data Model

- [x] 1.1 Add `ReadingFont` type and `readingFont` field to `AppSettings` in `src/db/types.ts`
- [x] 1.2 Add `readingFont: 'serif'` to `DEFAULT_SETTINGS`

## 2. CSS Variable

- [x] 2.1 Add `--reading-font: var(--serif-stack)` to `:root` in `src/styles.css`
- [x] 2.2 Change `.reading .reading-body` font-family from `var(--serif-stack)` to `var(--reading-font)`
- [x] 2.3 Change `.reading .reading-body h1, h2, h3` font-family from `var(--serif-stack)` to `var(--reading-font)`
- [x] 2.4 Change `.reading .reading-title` font-family from `var(--serif-stack)` to `var(--reading-font)`

## 3. JavaScript Application

- [x] 3.1 Export `applyReadingFont(font)` function in `src/state.tsx` that sets `--reading-font` CSS variable on `<html>`
- [x] 3.2 Call `applyReadingFont(s.readingFont)` in boot sequence after `applyTheme(s.theme)`

## 4. Settings UI

- [x] 4.1 Import `ReadingFont` type and `applyReadingFont` in `src/components/SettingsDrawer.tsx`
- [x] 4.2 Add font selector row with `<select>` (Serif / Sans-serif) in the Appearance group
- [x] 4.3 Wire change handler to call `applyReadingFont()` then `ctx.saveSettingsPatch()`

## 5. Verification

- [x] 5.1 Run `npm run typecheck` — zero errors
- [x] 5.2 Run `npm run lint` — zero warnings
- [x] 5.3 Run `npm test` — all passing
- [x] 5.4 Manual smoke test: toggle font, reload page, confirm persistence
