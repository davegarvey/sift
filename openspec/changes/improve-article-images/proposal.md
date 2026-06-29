## Why

Many articles don't display images due to three bugs in the image-inlining pipeline and a Readability limitation that strips all images from certain sites (e.g. BBC News). This change fixes the bugs and adds a fallback hero image from the feed when Readability produces image-free output.

## What Changes

- Fix three image-inlining bugs in the extraction pipeline:
  1. **Mixed-content bug**: when the `/img?url=` proxy fetch fails, the `<img>` retains its original HTTP `src`, which the browser blocks as mixed content. Fix: remove `src` on failure.
  2. **Relative URL resolution bug**: `document.baseURI` (the Sift app URL) is used as the base for resolving relative image URLs instead of the original article URL. Fix: pass the article URL as the base.
  3. **MIME fallback bug**: hardcoded to `image/png` when upstream has no Content-Type. Fix: omit type from data: URI when unknown.
- Add `console.warn` logging in `fetchImageAsDataUri` when image fetches fail, so failures are observable in DevTools.
- Inject a hero image (from the feed item's `media:thumbnail`) at the top of extracted content when Readability output contains zero `<img>` tags, fetched via the `/img?url=` proxy.

## Capabilities

### New Capabilities
- `hero-image-injection`: When Readability extracts article content with no `<img>` elements, inject the feed's `media:thumbnail` as a hero image at the top of the extracted HTML, inlined as a `data:` URI via `/img?url=`.

### Modified Capabilities
- `article-reader`: Update the image inlining requirement to cover:
  - Graceful degradation when image proxy fetch fails (remove `src` instead of leaving a broken URL)
  - Relative URL resolution against the article's original URL
  - MIME type handling for missing Content-Type
  - Observable logging of image fetch failures

## Impact

- `src/feeds/fetch.ts`: `fetchImageAsDataUri` — MIME fallback, logging
- `src/articles/extract.ts`: `inlineImages` — relative URL base, failed-image src handling
- `src/articles/service.ts` or `extract.ts`: hero image injection from feed thumbnail
- `src/db/types.ts`: optional `thumbnail` field on `Item` if not already present (depends on feed parser)
