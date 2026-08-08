## Why

Mobile reading view feedback round (2026-08-08):

1. An article with an embedded video (Simon Willison's Weblog, YouTube embed) overflowed the viewport — the reading body only constrains `img`, not `iframe`/`video`/`embed`.
2. Prev/next chevrons live in the top chrome as two small CTAs that are hard to reach and use on a phone.
3. The help CTA (keyboard shortcuts) leaks onto mobile: the `@media (any-pointer: coarse)` touch-target rule sets `display: inline-flex` on `.reading .reading-chrome .desktop-only`, whose higher specificity overrides `.desktop-only { display: none }` from the ≤768px block. It should be desktop-only.
4. The back CTA is hard to reach top-left, but the native browser edge-swipe back already works, so it stays in place rather than moving.
5. Prev/next should also be reachable by swipe left/right — the fastest path on a phone — without tripping on vertical scroll or the browser's native back edge-swipe.

## What Changes

- **Mobile bottom action bar** (mobile viewports only): a bottom bar in reading view with prev (far left), star and open (central), next (far right). The mobile prev/next chevrons are removed from the top chrome, freeing the full top row for the article title.
- **Swipe prev/next** (mobile only): swipe left → next article, swipe right → prev article, following the finger with a clamped translate and snapping back when the swipe doesn't cross the commit threshold. Reuses the hardened gesture discipline from the river swipe engine (dead zone, axis lock, `pointercancel` cleanup, touch-only). Gestures starting in the screen-edge zones are left to the browser's native back/forward swipe. Gestures starting on links, iframes/videos, or horizontally scrollable blocks (`pre`, overflow-x) are not captured.
- **Back CTA unchanged**: stays top-left in the reading chrome, same behavior as today.
- **Help CTA fixed to desktop-only**: remove `.desktop-only` from the `any-pointer: coarse` touch-target selector (or equivalent explicit hide) so it no longer renders on mobile. Desktop behavior unchanged.
- **Embedded media fit**: normalize `iframe`/`video`/`embed` elements during extraction so they never exceed the reading column width, preserving aspect ratio. CSS `max-width: 100%` added as a safety net for any media the extractor doesn't touch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reader-ui` — mobile reading view chrome: bottom action bar replaces top-chrome prev/next; help CTA is desktop-only.
- `article-reader` — embedded media (iframe/video/embed) is constrained to the reading column width with aspect ratio preserved.

## Impact

- `src/components/ReadingView.tsx` — move prev/next into a mobile bottom bar; remove mobile chrome chevrons; keep back top-left; keep help desktop-only
- `src/styles.css` — bottom bar layout (fixed, safe-area padding), remove mobile chevron styles, fix `.desktop-only` override in the coarse-pointer block, media `max-width` fallback
- `src/articles/extract.ts` — normalize iframe/video/embed width/height to aspect-ratio-fit
- No API, routing, or state changes
