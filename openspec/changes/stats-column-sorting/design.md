## Context

See `proposal.md` for the motivation and scope. The current stats view keeps a `readOnce`/`readRate`/`backlog` sort key in component state and renders it as a native select above a CSS-grid table. The table headings are present only as non-interactive role elements, and the mobile layout hides the heading row while rendering labels on each value. Application settings already persist locally in the IndexedDB `meta` store through the shared settings helpers; sync transports feed data, current flags, and aggregate statistics, not presentation settings.

## Goals / Non-Goals

**Goals:**

- Make the visible stats columns the primary desktop sorting affordance.
- Give every column a predictable two-direction sort model.
- Preserve the existing responsive card-like mobile layout while retaining sort access.
- Persist one local active column/direction pair without adding sync protocol or database changes.
- Keep unavailable derived metrics and ties legible and deterministic.

**Non-Goals:**

- Adding a visible backlog metric or changing the underlying stats calculations.
- Remembering separate sort directions for every column.
- Synchronizing presentation preferences across devices.
- Adding multi-column user-configurable sorting.

## Decisions

### Use one active column and direction

Represent the sort selection as one column plus one direction. A new numeric column starts descending because the existing stats view emphasizes highest values, while Feed starts ascending because alphabetical navigation conventionally begins at A. Re-selecting the active heading toggles its direction. This is simpler than maintaining independent direction state for every column and makes the active table state unambiguous.

Alternative: retain named sort options in a select and add ascending variants. Rejected because it keeps the sort model detached from the table and produces a long, repetitive option list.

### Sort only visible columns

Expose Feed, Articles, Read, Rate, Expected, and Preference as headings. Remove backlog from the sort model because it is currently a hidden derived value. If backlog becomes important later, it should be added as an explicitly labeled column rather than remaining an invisible ordering criterion.

Alternative: keep a separate backlog option beside the clickable headings. Rejected because two sorting systems would compete and the current label is difficult to distinguish from mutable unread state.

### Preserve null values at the bottom

Treat unavailable Rate, Expected, and Preference values as a separate class that follows all numeric values for both ascending and descending sorts. Use the existing case-insensitive title ordering for ties. This prevents an empty feed from appearing first merely because its unavailable value is represented internally as a sentinel.

Alternative: let nulls follow ordinary numeric ascending order. Rejected because “Not enough data” at the top would make the least informative rows dominate the view.

### Use header buttons on desktop and a mobile fallback

Render keyboard-operable buttons inside the desktop column headers, keeping the table grid and sticky header. Apply `aria-sort` to the active column header and show a directional Lucide icon only for that column. Keep a compact native sort control available at narrow widths because the current mobile layout intentionally hides the desktop heading row and turns each row into a two-column card.

Alternative: make the mobile table horizontally scrollable to preserve the header row. Rejected because it would undermine the existing mobile reading layout and make six narrow stats columns difficult to use.

### Store the preference with local application settings

Add an optional stats sort preference to the existing local settings object. Validate the stored column and direction when hydrating settings and fall back to Read descending if the value is missing or invalid. Saving the choice through the existing settings helper keeps it local and does not involve the sync queue, server schema, or sync cursors.

Alternative: store the choice only in component state or in the URL. Component state would be lost between visits, while the URL would make a personal presentation choice shareable and add routing complexity without a product need.

## Risks / Trade-offs

- [Risk] A two-direction sort can surface zero-volume or low-volume feeds before more meaningful feeds. -> [Mitigation] Keep raw Articles values visible, retain the definitions panel, and use the existing deterministic ordering rather than inventing a confidence score.
- [Risk] The mobile fallback duplicates the desktop sorting affordance. -> [Mitigation] Render only the fallback on narrow layouts and use the same persisted sort model for both controls.
- [Risk] Stored settings may contain malformed values after manual or older persistence. -> [Mitigation] Validate the pair during settings hydration and use the documented default.

## Migration Plan

1. Add the optional local sort preference with no IndexedDB schema migration; existing settings without it use Read descending.
2. Replace the desktop sort select with sortable headings and retain a narrow-layout fallback.
3. Update service, view, and accessibility tests for direction changes, null placement, persistence, and responsive access.
4. If the change is rolled back, clients without the new fields ignore the optional local setting and continue using the existing select behavior.

## Open Questions

None.
