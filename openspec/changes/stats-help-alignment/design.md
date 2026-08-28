## Context

See `proposal.md` and the existing `stats-help-layout` main spec. The help CTA and Stats kicker already share `.stats-heading-top`, but that row is inside `.stats-header`, whose `max-width` is 720px. The summary and feed table are siblings constrained only by the wider `.stats-inner` container, so the CTA is visibly inset from their right edge on larger screens.

## Goals / Non-Goals

**Goals:**

- Align the help CTA with the right edge of the stats summary and feed table.
- Keep the heading copy at its existing readable widths.
- Preserve the same-row mobile layout and help-panel behavior.

**Non-Goals:**

- Changing the stats content, controls, or help copy.
- Changing the overall page container, summary, or table widths.
- Adding new responsive breakpoints or dependencies.

## Decisions

### Make the heading wrapper full width and constrain copy separately

Allow `.stats-header` to occupy the full `.stats-inner` content boundary so `.stats-heading-top` can justify the CTA against the same edge as the components below. Apply the existing 720px readability constraint to the page title while retaining the paragraph's current character-width constraint. This keeps visual text wrapping stable while correcting the alignment anchor.

Alternative: offset the help row with a negative margin or an absolute right position. Rejected because those approaches couple the control to a specific container width and can drift at responsive breakpoints.

### Keep the help wrapper as the panel containing block

Retain the relative `.stats-help` wrapper and the existing absolute definitions panel. Only the wrapper's horizontal position changes, so focus management, dismissal listeners, panel width, and right alignment remain intact.

Alternative: move the panel to the page-heading container. Rejected because it would reintroduce a mismatch between the CTA and the panel anchor.

## Risks / Trade-offs

- [Risk] The heading row has more horizontal space than the text copy and may create a large gap on desktop. -> [Mitigation] Keep the row limited to the existing `.stats-inner` boundary and retain the compact button styling.
- [Risk] The help panel's right edge changes with the wider wrapper. -> [Mitigation] Preserve the existing viewport-clamped width and verify the panel remains adjacent to the CTA.

## Migration Plan

1. Move the width constraint from the header wrapper to the title copy.
2. Add a structural regression assertion for the full-width heading boundary and rerun the stats checks.
3. No persisted data or rollback migration is required.

## Open Questions

None.
