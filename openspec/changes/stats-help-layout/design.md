## Context

See `proposal.md` for the motivation and scope. The stats heading currently renders the kicker and header copy in one element while the help control is a sibling positioned absolutely from the page-heading wrapper. Mobile adds 48px of top padding to the header to avoid that control overlapping the heading. The definitions panel is also absolutely positioned and uses the help wrapper as its intended visual anchor.

## Goals / Non-Goals

**Goals:**

- Align the help CTA with the Stats kicker in a single heading row.
- Remove unnecessary mobile vertical space.
- Keep the existing help panel behavior and focus management intact.
- Keep the layout usable at narrow widths.

**Non-Goals:**

- Changing help copy, definitions, or accessibility semantics.
- Changing stats data or table controls.
- Making the help panel a modal or changing its dismissal rules.

## Decisions

### Use a dedicated heading row

Wrap the kicker and help control in a flex row inside the stats header. The help wrapper becomes relatively positioned so the existing definitions panel can remain absolutely positioned directly beneath it. The heading row distributes the two controls without reserving a separate overlay band.

Alternative: keep the help wrapper absolutely positioned and only reduce mobile padding. Rejected because the control would remain visually detached from the kicker and still rely on positional overlap rules.

### Remove the mobile spacer

Delete the mobile header top padding that compensates for the old absolute help placement. The normal heading flow now accounts for the help control, while the panel remains an overlay opened on demand.

Alternative: retain a smaller fixed spacer for mobile. Rejected because it preserves the unnecessary vertical gap the change is intended to remove.

### Preserve the existing panel anchor and behavior

Keep the current panel width, right alignment, focus target, outside-pointer dismissal, and Escape handling. Only its containing block changes from the page-heading wrapper to the help wrapper, which keeps the panel visually attached to the CTA.

Alternative: move the panel below the full page heading in normal flow. Rejected because opening help would shift the stats page and would require a new dismissal/layout model.

## Risks / Trade-offs

- [Risk] The kicker and labeled help button may approach each other at very narrow widths. -> [Mitigation] Use a flex row with a gap and keep the help button non-shrinking; the existing panel width already clamps to the viewport.
- [Risk] The panel's containing block changes when the help wrapper moves. -> [Mitigation] Preserve absolute positioning and test that the panel remains associated with the help CTA.

## Migration Plan

1. Move the help wrapper into the kicker row and make it the panel's containing block.
2. Remove the mobile spacer and add heading-layout assertions to the stats view test.
3. No persisted data or rollback migration is required.

## Open Questions

None.
