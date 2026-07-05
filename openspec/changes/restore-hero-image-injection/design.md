## Context

When a feed provides only a summary (no `<content:encoded>`), `openItemForReading` falls through to `extractArticle`, which fetches the article URL via `/article?url=`, runs Readability, and returns the cleaned-up HTML. The body is then rendered directly in the reading view.

For many publishers — including BBC News — the Readability output is almost entirely text: the actual article images are lazy-loaded by JavaScript on the page, so Readability sees no `<img>` elements to preserve. The result is a reading view that opens to a wall of text with no visual entry point.

The prior implementation handled this by injecting a hero `<img>` at the top of the body. The image source was the article's `og:image` (preferred) or the feed's `media:thumbnail` (fallback), fetched once as a `data:` URI and stored directly in `extractedHtml`. The `fix-performance-at-scale` change removed this because data: URI inlining of *every* image was the dominant source of storage bloat. But the hero injection is a single image and a different problem — it shouldn't have been collateral damage.

## Goals / Non-Goals

**Goals:**
- Restore the hero image injection for articles whose Readability output contains no images
- Use the same `/img?url=` proxy pattern that the rest of the body uses — no `data:` URIs, no inline storage
- Three-tier fallback: `og:image` → feed `thumbnail` → no hero
- Keep the change small and self-contained: only `src/articles/extract.ts`

**Non-Goals:**
- No re-introduction of the data: URI inlining pipeline
- No changes to the `extractedHtml` storage shape beyond a single injected `<img>` tag
- No changes to the eviction subsystem, the schema, or `service.ts`
- Not retroactively fixing cached extracted articles whose previous hero was a data: URI; they will re-extract on next open

## Decisions

**Use the proxy URL pattern instead of `fetchImageAsDataUri`.**
- The existing `rewriteImagesToProxy` already produces `<img src="/img?url=<encoded>" data-original-src="<absolute>">`. Reusing the exact same pattern for the hero image keeps the storage cost at a single URL string (a few hundred bytes) instead of a base64-encoded image blob (tens to hundreds of KB).
- The browser fetches the hero image on-demand when the reading view renders it, with the existing 30-day `immutable` cache on the `/img?url=` proxy.

**Re-query the document for `og:image` before Readability.**
- Readability mutates and strips `<head>`, so the meta tag must be captured first. The same pattern was used in the original implementation and in the `og-image-hero` change (now archived).
- The query is a single `querySelector` against the already-parsed DOM — no additional fetch.

**Single `injectHeroImageProxy` helper, scoped to `extract.ts`.**
- Mirrors the original `injectHeroImage` function's responsibility: take HTML + a hero URL, return HTML with the hero prepended if no existing `<img>` exists.
- Returns the input HTML unchanged when the body already contains images or the hero URL is falsy.

**No cache invalidation for previously-extracted articles.**
- Articles extracted before this change have no hero in their cached `extractedHtml` (the prior change removed it). When those items are next opened, `openItemForReading` Path 2 (cached `extractedHtml`) takes priority and they continue to render without a hero. This is acceptable: the cache will refresh organically as items are evicted under the new global LRU policy, and a forced re-extraction pass would be a larger change than this fix warrants.

## Risks / Trade-offs

- **`og:image` may not match the article's editorial intent** → Same risk as the original implementation; OG images are usually editorial and high-res, so this is a net improvement over a missing hero.
- **Proxy fetch failure for the hero image** → The browser will render a broken image icon. Acceptable: the previous implementation had the same risk (the data: URI would have been a 404), and the `/img?url=` proxy is now cached for 30 days so the first failure persists.
- **Stale cached `extractedHtml` from the prior commit continues to show no hero** → Documented above; not worth a forced re-extraction for this fix.
