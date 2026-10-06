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

### Requirement: Eviction clears the earliest-opened articles first under storage pressure
Instead of age-based retention tiers, the eviction routine SHALL compare the origin's storage usage with a quota-based soft cap. When usage exceeds the cap, it SHALL set `extractedHtml` to null on items in ascending `firstOpenedAt` order until the length of the cleared HTML covers the excess. Order SHALL be by first open, not by most recent access. Items without `firstOpenedAt` SHALL be ordered after every opened item. The routine SHALL run after each scheduled feed refresh sweep.

#### Scenario: Usage under soft cap — no eviction
- **WHEN** storage usage is at or below the soft cap
- **THEN** no items SHALL have their `extractedHtml` dropped

#### Scenario: Usage exceeds soft cap — earliest-opened items are evicted
- **WHEN** storage usage exceeds the soft cap
- **THEN** items with `extractedHtml` SHALL be sorted by `firstOpenedAt` ascending and have their `extractedHtml` set to null, earliest first, until the length of the cleared HTML covers the excess

#### Scenario: Items without an open time are evicted last
- **WHEN** an item with `extractedHtml` has no `firstOpenedAt`
- **THEN** it SHALL be evicted only after every item that has a `firstOpenedAt`

### Requirement: Soft cap is quota-aware
The eviction routine SHALL use `navigator.storage.estimate()` and set the soft cap to 5% of the reported quota (`STORAGE_SOFT_CAP_RATIO`), with no further fixed maximum. When the Storage API is unavailable, or reports no quota or no usage, eviction SHALL NOT run.

#### Scenario: Quota-aware cap on a high-storage device
- **WHEN** a user's device provides a quota of 200 GB to the origin
- **THEN** the soft cap SHALL be 10 GB

#### Scenario: Quota-aware cap on a low-storage device
- **WHEN** a user's device provides a quota of 2 GB
- **THEN** the soft cap SHALL be 100 MB

#### Scenario: Storage API unavailable
- **WHEN** `navigator.storage.estimate()` is unavailable or reports no quota or usage
- **THEN** no items SHALL have their `extractedHtml` dropped

### Requirement: Eviction writes are batched in chunks
Eviction SHALL process items in chunks of 500 (`EVICTION_CHUNK_SIZE`) per readwrite transaction. If a chunk's transaction fails, that run SHALL stop; the next run SHALL recompute usage and candidates from the current state.

#### Scenario: Chunked eviction
- **WHEN** 1,200 items need `extractedHtml` dropped
- **THEN** the items SHALL be processed in three chunks of 500, 500, and 200, each in a separate readwrite transaction

### Requirement: Eviction never drops item metadata
Eviction SHALL only set `extractedHtml` to null. It SHALL NOT modify item metadata (title, excerpt, link, dates, read state, starred state, `item.html`, `itemFlags`), and SHALL NOT delete entire items from the database.

#### Scenario: Metadata is preserved after eviction
- **WHEN** an item's `extractedHtml` is dropped
- **THEN** its `id`, `feedUrl`, `guid`, `title`, `author`, `link`, `publishedAt`, `updatedAt`, `createdAt`, `excerpt`, `html`, `thumbnail`, `firstOpenedAt`, `read`, and `starred` SHALL remain unchanged