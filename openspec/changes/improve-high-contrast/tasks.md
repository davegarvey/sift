## 1. Data Model

- [x] 1.1 Remove `'accessible'` from `ThemePreference` type in `src/db/types.ts`
- [x] 1.2 Add `highContrast: boolean` to `AppSettings` interface
- [x] 1.3 Add `highContrast: false` to `DEFAULT_SETTINGS`

## 2. State / applyTheme

- [x] 2.1 Update `applyTheme()` in `src/state.tsx` to accept `(theme, highContrast)` parameters
- [x] 2.2 Update boot sequence to read and apply both `theme` and `highContrast` from settings

## 3. CSS — High Contrast Palettes

- [x] 3.1 Replace `:root[data-a11y]` block with full light HC variable overrides
- [x] 3.2 Add `:root[data-a11y][data-theme="dark"]` block with full dark HC variable overrides
- [x] 3.3 Add `@media (prefers-color-scheme: dark)` block for system-follow dark HC
- [x] 3.4 Keep `:root[data-a11y] .river-item.read { opacity: 1 }` rule
- [x] 3.5 Remove the old minimal HC block (lines 579–591 of styles.css)

## 4. Settings UI

- [x] 4.1 Reduce theme `<select>` to 3 options (system, light, dark)
- [x] 4.2 Add "High contrast" toggle below theme selector
- [x] 4.3 Wire toggle to save both `theme` and `highContrast` via `saveSettingsPatch`

## 5. Verification

- [x] 5.1 Run `npm run typecheck` — zero errors
- [x] 5.2 Run `npm run lint` — zero pre-existing warnings (only `.opencode/plugins/crit.ts` unrelated)
- [x] 5.3 Run `npm test` — 18/18 passing
- [ ] 5.4 Manual: toggle HC on/off in light, dark, and system modes; confirm palette switches correctly
- [ ] 5.5 Manual: confirm HC persists across page reload
