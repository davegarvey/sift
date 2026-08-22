## Why

The `fix-performance-at-scale` change removed the entire image-inlining subsystem from `extractArticle` to stop storing `data:` URIs in `extractedHtml` (which bloated per-article storage to multiple MBs). In the process, it also removed the hero image injection — the fallback that put an `<img>` at the top of the reading view body when the extracted article had no images and the feed only provided a summary + thumbnail.

This regresses the reading experience for summary-only feeds like BBC News, which provide only a `<description>` and `<media:thumbnail>` (no `<content:encoded>`) and therefore always go through Readability extraction. BBC's Readability output is mostly text with no inline images, so without a hero fallback the reading view opens to a wall of text.

The right fix is to restore the hero image injection but use the proxy URL pattern (`/img?url=...`) instead of `data:` URIs — same image, no upfront fetch, no storage bloat.

## What Changes

- In `extractArticle`, query `<meta property="og:image">` from the parsed document before passing it to Readability (which strips `<head>`).
- After `rewriteImagesToProxy`, if the resulting HTML contains no `<img>` elements and a hero source is available (`og:image` → feed `thumbnail`), inject a single `<img>` element at the top of the body.
- The injected `<img>` uses `/img?url=<encoded>` as its `src` and stores the absolute original URL in `data-original-src` — the same pattern `rewriteImagesToProxy` already uses for in-article images. No `fetchImageAsDataUri` call, no `data:` URI.
- No changes to `service.ts`, `eviction.ts`, the schema, or any other module. The `thumbnailUrl` parameter on `extractArticle` is already wired in by `openItemForReading` but currently unused.

## Capabilities

### New Capabilities
- `hero-image-injection`: When a Readability-extracted article body contains no `<img>` elements, inject a hero image at the top using the article's `og:image` (preferred) or the feed's `thumbnail` (fallback), served via the `/img?url=` proxy.

### Modified Capabilities
*(None)*

## Impact

- `src/articles/extract.ts`: Re-add `og:image` extraction and a new internal `injectHeroImageProxy` helper. No new imports needed.
- `src/feeds/fetch.ts`: `fetchImageAsDataUri` remains unused (dead code from the prior removal) — leave for a future cleanup.
- No schema changes, no eviction changes, no service-layer changes.
