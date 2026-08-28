## 1. Local Sort Preference

- [x] 1.1 Add the optional stats sort column/direction setting and validate it during settings hydration with Read descending as the fallback.
- [x] 1.2 Persist stats sort changes through the existing local settings helper without adding sync or database protocol state.

## 2. Sort Model

- [x] 2.1 Replace the one-way stats sort key with visible-column and direction ordering for feed title, Articles, Read, Rate, Expected, and Preference.
- [x] 2.2 Keep unavailable derived values last in both directions and preserve deterministic title tie-breaking.
- [x] 2.3 Add service coverage for defaults, direction toggles, every sortable column, null placement, and title ordering.

## 3. Stats View Controls

- [x] 3.1 Replace the desktop sort select with keyboard-operable sortable column headings, active direction indicators, and accessible sort state.
- [x] 3.2 Add the narrow-layout sort fallback using the same column/direction model and persisted preference.
- [x] 3.3 Update responsive styles so the desktop header controls and mobile fallback remain clear without changing the existing row layout.
- [x] 3.4 Extend stats view coverage for heading interaction, persistence, accessibility, and narrow-layout access.

## 4. Verification

- [x] 4.1 Run strict OpenSpec validation and the repository typecheck, lint, and test commands.
- [x] 4.2 Review the final diff and confirm no sync payload, server, or database migration changes were introduced.
