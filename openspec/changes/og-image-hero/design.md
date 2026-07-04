## Context

When the reading view shows an article whose feed only provided a summary, Sift runs Readability to extract the full content and then calls `injectHeroImage()` to add a hero image at the top if the extracted HTML has no `<img>` elements. Currently the only hero image source is the feed's `<media:thumbnail>`, which for video articles is often a tiny video poster rather than an editorial image.

Every major publisher sets `<meta property="og:image" content="...">` in their article HTML — typically a high-resolution 1200×630px or 1024px image.

## Goals / Non-Goals

**Goals:**
- Use the article's `og:image` as the preferred hero image source when available
- Fall back to the feed's `thumbnail` when no `og:image` is found
- Fall back to no hero image when neither source is available
- Reuse the existing `/img?url=` proxy and `fetchImageAsDataUri` pipeline

**Non-Goals:**
- No schema changes or data migration
- No changes to image eviction or inline-image handling
- Not retroactively fixing cached extracted articles (they already have their hero image inlined)

## Decisions

**Query `og:image` in `extractArticle` after Readability extraction, before `injectHeroImage`.**
- The article HTML is already parsed into a DOM document for Readability — querying `<meta property="og:image">` from it is a single `querySelector` call with no additional fetch.
- The OG image URL is passed to the existing `injectHeroImage` as a preferred source.

**Reuse `fetchImageAsDataUri` rather than adding new fetch logic.**
- The same `/img?url=` proxy handles caching, relative URL resolution isn't needed (OG URLs are always absolute), and we already have the data-URI conversion pipeline.

**Three-tier fallback: `og:image` → feed `thumbnail` → none.**
- OG image is preferred because it's editorial and high-res. Feed thumbnail is used as a fallback. If neither exists, `injectHeroImage` is not called and no hero image is shown.

## Risks / Trade-offs

- **`og:image` may not match the article's thumbnail intent** → Still a net improvement; an editorial image is always better than a video poster.
- **Extra data URI fetch on first open** → Same cost as the existing thumbnail fetch; negligible.
- **Some pages have `og:image` that requires cookies/auth** → The `/img?url=` proxy passes no credentials, so these would fail gracefully and we fall through to the feed thumbnail.
