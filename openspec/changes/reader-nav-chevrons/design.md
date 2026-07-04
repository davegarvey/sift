## Context

The reading view currently offers j/k keyboard shortcuts for prev/next article navigation but has no visible affordance. The sticky chrome shows feed name + relative time — information that duplicates the body byline — and uses "← All" text that's unnecessary when an arrow alone is universally understood.

This change adds subtle visual navigation, cleans up the chrome, and improves the byline with human-readable relative dates.

## Goals / Non-Goals

**Goals:**
- Add ◀ ▶ chevron navigation to reading view on both desktop and mobile
- Remove feed name and relative time from the chrome
- Move feed name into the body byline
- Replace raw date stamps in byline with human-readable relative time
- Replace "← All" with just a back arrow (no text)

**Non-Goals:**
- Adding swipe navigation (out of scope — system back gesture conflict)
- Adding transitions or animations between articles (content swap only)
- Changing the river view or item list
- Changing keyboard shortcuts (j/k remain unchanged)

## Decisions

### Chevron placement — desktop: margin gutters vs overlaid on content
- **Chosen**: Chevrons float in the empty margin gutters on either side of the centered `65ch` content column
- **Rationale**: On any viewport wider than ~1300px there is ample margin space. Chevrons overlay nothing. No content is obscured.
- **Alternative considered**: Overlaying on content edges. Rejected because it would obscure article text.

### Chevron placement — mobile: chrome vs fixed bottom bar
- **Chosen**: Chevrons in the sticky chrome (same row as back arrow and actions)
- **Rationale**: Chrome is already sticky and always visible. No additional UI surface needed. Works with one hand (top of screen).
- **Alternative considered**: Fixed bottom mini-bar. Rejected — adds complexity and conflicting with mobile browser chrome.

### Hit zone: full margin strip vs icon-only
- **Chosen**: The entire margin strip (~50-60px from viewport edge) is the hit zone, not just the chevron icon
- **Rationale**: Larger target area improves usability, especially when the chevron is faint. Matches patterns like ChatGPT's collapsed nav. The chevron icon itself remains the only visible element; the invisible hit zone extends to fill the margin.

### Boundary behavior: ghosted vs hidden
- **Chosen**: Ghosted (reduced opacity, non-interactive) at first/last item. Hidden entirely when only one item.
- **Rationale**: Ghosting preserves layout stability (elements don't shift in/out). Hidden for single-item results avoids showing useless disabled UI.

### Desktop chevron opacity: faint then full on hover
- **Chosen**: Always faint at rest (~15% opacity), CSS transition (`opacity 0.15s ease`) to full on hover
- **Rationale**: Provides persistent affordance without visual noise. The hover reveals them when the user's mouse is in the area.

### Relative time precision: decay over age
- **Chosen**: "2h ago" → "last Wed" → "last month" → "Jun 2026"
- **Rationale**: Recent items need precise relative time. Older items benefit from less precision — "Jun 2026" is more readable than "3 months ago". Approximate thresholds: <24h = hours, <7d = day name, <60d = "last month", else month/year.

## Risks / Trade-offs

- **Discoverability of desktop chevrons**: Users must notice faint chevrons in the margin. Mitigation: once a user uses j/k once, they'll notice the chevrons on mouseover. The faint persistent state is a secondary cue.
- **Mobile chrome space**: Adding ◀ ▶ to an already tight chrome might crowd on very narrow phones (<375px). Mitigation: chevrons can shrink or use smaller hit targets on narrow viewports.
- **Right margin chevron conflicts with scrollbar**: On macOS with "always show scrollbars" enabled, the right chevron's hit zone may overlap. Acceptable — the hover zone can be inset by scrollbar width on those systems.

## Open Questions

None resolved during design.
