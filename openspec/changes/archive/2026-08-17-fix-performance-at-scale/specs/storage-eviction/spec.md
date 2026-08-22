## ADDED Requirements

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

### Requirement: Eviction is LRU-based under storage pressure
Instead of age-based retention tiers, the eviction routine SHALL monitor total IndexedDB usage and drop `extractedHtml` from least-recently-accessed items when a soft cap is exceeded. The soft cap SHALL be derived from the browser's storage quota.

#### Scenario: Usage under soft cap — no eviction
- **WHEN** total IndexedDB usage is below the soft cap
- **THEN** no items SHALL have their `extractedHtml` dropped

#### Scenario: Usage exceeds soft cap — oldest-accessed items are evicted
- **WHEN** total IndexedDB usage exceeds the soft cap
- **THEN** items SHALL be sorted by `firstOpenedAt` ascending and have their `extractedHtml` set to null, oldest first, until usage falls below the cap

#### Scenario: Items never opened are evicted first
- **WHEN** `firstOpenedAt` is null
- **THEN** those items SHALL be treated as having the oldest access time and evicted first

### Requirement: Soft cap is quota-aware
The eviction routine SHALL use `navigator.storage.estimate()` to determine the soft cap: `min(quota * 0.05, quota * 0.5)`. If the API is unavailable, a fixed fallback of 500 MB SHALL be used.

#### Scenario: Quota-aware cap on a high-storage device
- **WHEN** a user's device provides a quota of 200 GB to the origin
- **THEN** the soft cap SHALL be `min(200GB * 0.05, 200GB * 0.5)` = `min(10GB, 100GB)` = 10 GB, capped to a reasonable maximum

#### Scenario: Quota-aware cap on a low-storage device
- **WHEN** a user's device provides a quota of 2 GB
- **THEN** the soft cap SHALL be `min(2GB * 0.05, 2GB * 0.5)` = `min(100MB, 1GB)` = 100 MB

#### Scenario: Fallback when API unavailable
- **WHEN** `navigator.storage.estimate()` is unavailable
- **THEN** the soft cap SHALL default to 500 MB

### Requirement: Eviction writes are batched in chunks
LRU eviction SHALL process items in chunks of 500 per readwrite transaction. If a chunk's transaction times out, it SHALL be retried on the next eviction tick.

#### Scenario: Chunked eviction
- **WHEN** 1,200 items need `extractedHtml` dropped
- **THEN** the items SHALL be processed in three chunks of 500, 500, and 200, each in a separate readwrite transaction

### Requirement: Eviction never drops item metadata
LRU eviction SHALL only set `extractedHtml` to null. It SHALL NOT modify item metadata (title, excerpt, link, dates, read state, starred state, `item.html`, `itemFlags`), and SHALL NOT delete entire items from the database.

#### Scenario: Metadata is preserved after eviction
- **WHEN** an item's `extractedHtml` is dropped
- **THEN** its `id`, `feedUrl`, `guid`, `title`, `author`, `link`, `publishedAt`, `updatedAt`, `createdAt`, `excerpt`, `html`, `thumbnail`, `firstOpenedAt`, `read`, and `starred` SHALL remain unchanged
