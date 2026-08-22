## Why

Feed `<media:thumbnail>` images are often low-res video posters or auto-generated thumbnails. Most publishers set `<meta property="og:image">` with a high-quality editorial hero shot (1200×630px or 1024px), which would look far better as the hero image in the reading view.

## What Changes

- In `extractArticle`, after parsing the article HTML and before calling `injectHeroImage`, query the document for `<meta property="og:image" content="...">`.
- If found, fetch it as a data URI via `/img?url=` (reusing the existing `fetchImageAsDataUri` pipeline) and use it as the preferred hero image source.
- Three-tier fallback: `og:image` → feed `thumbnail` → no hero image.

## Capabilities

### New Capabilities
- `og-image-hero`: prefer the Open Graph image from the article's HTML as the hero image, falling back to the feed's `<media:thumbnail>` when unavailable.

### Modified Capabilities

- *(none)*

## Impact

- Only `src/articles/extract.ts` is modified. No new dependencies, no schema changes.
