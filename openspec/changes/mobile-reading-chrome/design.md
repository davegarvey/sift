## Context

The reading view chrome currently holds, on mobile: back, prev/next chevrons, star, open, and (buggily) the desktop-only help CTA. That crowds the top row and pushes the article title into a narrow spacer. On a phone, the top of the screen is the hardest zone to reach one-handed, yet prev/next live there.

This change reorganizes mobile reading chrome: thumb-reachable actions move to a bottom bar, the top row keeps back + title, and the help CTA stops leaking onto touch devices. It also fixes embedded media overflowing the reading column.

## Goals / Non-Goals

**Goals:**
- Add a mobile bottom action bar: prev (far left), star and open (central), next (far right)
- Add mobile swipe left/right navigation between articles (left = next, right = prev)
- Remove mobile prev/next chevrons from the top chrome; give the title the full top row
- Keep the back CTA top-left (native edge-swipe back covers reachability)
- Make the help CTA truly desktop-only
- Constrain embedded media (iframe/video/embed) to the reading column width with correct aspect ratio

**Non-Goals:**
- Changing the desktop reading view layout (margin chevrons, chrome) — only the help-CSS bug touches desktop, as a bug fix
- Changing the river list, keyboard shortcuts, or routing
- Gesture-only chrome (removing the bottom bar in favor of swipe alone) — swipe supplements the bar, not replaces it

## Decisions

### Bottom bar placement and contents
- **Chosen**: Fixed bottom bar on mobile only, containing: prev (far left), star, open (central cluster), next (far right).
- **Rationale**: Bottom of the screen is the thumb zone on phones. Far-left/far-right placement matches thumb arcs and mirrors the top-chrome order users already know (back | prev/next | star | open). NetNewsWire uses a similar bottom-toolbar pattern.
- **Alternatives considered**: Keep everything top-left (rejected — reachability complaint), swipe gestures (deferred), gesture-only chrome (rejected — discoverability).

### Swipe navigation: reuse the river gesture discipline, exclude edges and interactive elements
- **Chosen**: Pointer-event swipe handler on the reading container (touch-only, gated on `pointerType === 'touch'` and `any-pointer: coarse`, same as River). Dead zone (~8px) before any visual shift; axis lock (bail when `|dy| >= 10 && |dy| > |dx|`); clamped `translateX` (~80px) following the finger; commit at ~60px else snap back. `touch-action: pan-y` on the reading container keeps vertical scroll native and routes horizontal gestures to JS.
- **Edge exclusion**: ignore gestures whose `pointerdown` starts within ~20-24px of the left or right screen edge, so iOS Safari's edge-swipe back and Android's predictive back keep working untouched.
- **Element exclusion**: skip the gesture when the touch starts on a link, button, iframe, video, or a horizontally scrollable block (`pre`, overflow-x).
- **Boundaries**: reuse `hasPrev`/`hasNext` — no navigation at first/last item, hidden entirely for a single item.
- **Rationale**: mirrors the river's battle-tested gesture engine (the `fix-swipe-scroll-jitter` work) — dead zone + axis lock prevent accidental triggers from vertical scroll, which was Dave's explicit concern. Edge/element exclusion prevents the two real conflicts: browser back swipe and horizontal scrolling inside content.
- **Alternatives considered**: gesture-only chrome (rejected — discoverability; bottom bar stays as the visible affordance), requiring the article to be scrolled to top before swiping (rejected — friction, and mid-article swipe is what readers expect), tap zones (rejected — conflicts with link taps).

### Back CTA stays top-left
- **Chosen**: Back remains the leftmost element of the top chrome.
- **Rationale**: It's the one CTA users expect to exist; browser edge-swipe back (iOS Safari, Android predictive back) already provides the fast path, and it's the lifeline for deep links/webviews where edge-swipe may not exist. Moving it to the bottom bar would compete with prev and confuse the mental model (back ≠ prev).

### Help CTA: fix the desktop-only leak, don't remove the button
- **Chosen**: Keep the help button on desktop; make sure it is hidden on mobile.
- **Root cause**: In the `@media (any-pointer: coarse)` block, the touch-target rule lists `.reading .reading-chrome .desktop-only` and sets `display: inline-flex`. That specificity (0,3,0) beats `.desktop-only { display: none }` (0,1,0) from the `max-width: 768px` block, so on touch devices the button renders even at mobile widths.
- **Fix**: Drop `.desktop-only` from the coarse-pointer selector list; the ≤768px `display: none` then applies. Desktop hover/focus styles stay as-is.
- **Rationale**: The keyboard-shortcuts overlay is genuinely desktop content; hiding it on mobile is the intended behavior (matches the `desktop-only` class semantics used everywhere else).

### Embedded media fit: normalize at extraction, CSS as fallback
- **Chosen**: In `src/articles/extract.ts`, for each `iframe`/`video`/`embed`, read `width`/`height` attributes and set inline `style="width:100%;height:auto;aspect-ratio:W/H"` (falling back to 16/9 when attributes are missing). Add `.reading .reading-body iframe, video, embed { max-width: 100% }` in CSS as a safety net.
- **Rationale**: Attribute-based aspect-ratio preserves the exact embed ratio (YouTube 16:9, Vimeo, SoundCloud differ). Doing it at extraction keeps the fix with the other media handling (image inlining) and avoids layout shift from runtime JS. CSS-only `aspect-ratio: 16/9` would distort non-16:9 embeds.
- **Alternatives considered**: CSS-only fix (rejected — distorts or leaves hardcoded ratio), runtime JS after render (rejected — layout shift, extra pass over DOM).

### Single-item / boundary behavior
- **Chosen**: Reuse the existing `hasPrev`/`hasNext` logic. At first/last item the corresponding bottom-bar button is disabled/ghosted; when there is only one item, prev/next are hidden entirely. Matches the existing chrome-chevron behavior, so no spec change beyond placement.

## Risks / Trade-offs

- **Bottom bar covers content**: The fixed bar overlays the bottom of the article. Mitigation: extend the reading body's bottom padding on mobile (safe-area padding already exists; add bar-height padding).
- **Tap targets**: Bottom-bar buttons get the existing coarse-pointer 44px minimum target sizing.
- **Title truncation**: With chevrons and star/open leaving the top row, the title gains significant width; existing ellipsis truncation still applies on very narrow screens.
- **Media with no width/height attrs**: 16/9 fallback may be wrong for rare embeds; acceptable — they were overflowing entirely before.

## Open Questions

- Should the bottom bar also appear on touch laptops (coarse pointer, wide viewport)? Default plan: no — `max-width: 768px` only, keeping desktop unchanged. Can revisit if touch-laptop usage complains.
