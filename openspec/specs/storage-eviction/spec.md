# storage-eviction Specification

## Purpose
Keep browser storage within quota by storing proxied image URLs instead of inline images, and clearing extracted article HTML in batches, earliest-opened first, under storage pressure while keeping item metadata.

## Requirements

### Requirement: Extracted HTML uses proxy URLs, not data: URIs
The `extractArticle()` function SHALL produce HTML with image URLs pointing to the `/img?url=` proxy rather than inlining images as `data:` URIs. This reduces `extractedHtml` from MBs to ~5-20 KB per article and allows the browser's HTTP cache to manage image re-fetching.

#### Scenario: Extracted article has proxy image URLs
- **WHEN** `extractArticle()` processes an article with images
- **THEN** each `<img>` element SHALL have `src` set to `/img?url=<encoded-upstream-url>` instead of a `data:` URI

#### Scenario: No data: URI generation
- **WHEN** `extractArticle()` processes any article
- **THEN** no image content SHALL be inlined as `data:` URIs in the returned HTML

### Requirement: Image-inlining functions are removed
The functions `inlineImages`, `stripImages`, `reinlineImages`, and `injectHeroImage` SHALL be removed from `src/articles/extract.ts` as they are no longer needed.

#### Scenario: Functions do not exist
- **WHEN** the codebase is searched for `inlineImages`, `stripImages`, `reinlineImages`, or `injectHeroImage`
- **THEN** they SHALL NOT exist

### Requirement: `/img` proxy cache is extended to 30 days
The `/img` proxy endpoint SHALL serve images with `Cache-Control: public, max-age=2592000, immutable` to ensure the browser's HTTP cache serves images on re-read without re-fetching. Article images rarely change, so a long cache is appropriate.

#### Scenario: Image proxy sets long cache header
- **WHEN** the `/img` proxy responds to a request
- **THEN** the response SHALL include `Cache-Control: public, max-age=2592000, immutable`
