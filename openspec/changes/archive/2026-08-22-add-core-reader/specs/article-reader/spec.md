## ADDED Requirements

### Requirement: Reading view SHALL render extracted full-text when only an excerpt exists in the feed
When an item's feed provides only an excerpt (no full content), the reading view SHALL fetch the article HTML via `GET /article?url=<item.link>` (or the item's home URL if no direct article link exists) and run Mozilla Readability to produce extracted HTML.

#### Scenario: User opens an item whose feed provides only an excerpt
- **WHEN** the user opens an item into reading view and the item's stored content is only an excerpt
- **THEN** the app fetches `GET /article?url=<item.link>` and runs Readability on the returned HTML
- **AND** the extracted full-text is rendered in the reading view body

#### Scenario: User opens an item whose feed provides full content
- **WHEN** the user opens an item whose stored content already includes the full article body
- **THEN** the app renders the stored full content directly without fetching upstream

#### Scenario: Extraction has already been performed for an item
- **WHEN** the user re-opens an item whose indexed record already contains extracted HTML
- **THEN** the app renders the cached extracted HTML without re-fetching upstream

### Requirement: Failed extraction SHALL degrade gracefully
When Readability cannot extract usable content from the fetched HTML (because the proxy returned an error status, the HTML is a paywall/bot-challenge page, or extraction produces an empty result), the reading view SHALL show the item's excerpt and a prominent "Open original ↗" link, with a short notice that extraction failed.

#### Scenario: Proxy returns an error for the article URL
- **WHEN** `GET /article?url=<item.link>` returns a non-2xx status
- **THEN** the reading view shows the item's stored excerpt with the notice "Couldn't extract this article" and a prominent "Open original ↗" link

#### Scenario: Readability produces no content
- **WHEN** Readability returns an empty article body or only boilerplate
- **THEN** the reading view shows the item's stored excerpt with the notice "Couldn't extract this article" and a prominent "Open original ↗" link

### Requirement: Article images SHALL be inlined as data: URIs in cached extracted HTML
During extraction, each `<img>` element's source SHALL be fetched via `GET /img?url=<encoded>` and inlined as a `data:` URI inside the cached `extractedHtml`. The original image URL SHALL be preserved as a `data-original-src` attribute so that re-extraction after eviction can re-fetch lazily.

#### Scenario: An extracted article body contains images
- **WHEN** the reading view renders extracted article HTML containing `<img>` elements
- **THEN** each `<img>` element's `src` is a `data:` URI produced by fetching the original image via `/img?url=`
- **AND** each `<img>` element retains `data-original-src` pointing at the original URL

#### Scenario: Mixed-content image on an HTTPS app
- **WHEN** the extracted article references an HTTP image URL and the app is served over HTTPS
- **THEN** the image is fetched via the server-side `/img` proxy (which is not subject to mixed-content policy) and inlined as a `data:` URI
- **AND** the image renders correctly in the reading view

### Requirement: Storage eviction SHALL bound IndexedDB growth from inlined images
The app SHALL run an eviction policy on extracted article HTML to prevent unbounded IndexedDB growth. The policy has two tiers: (1) items retain full `extractedHtml` with inlined images for a default of 7 days after first open; (2) when an item exceeds 30 days OR storage crosses a per-feed threshold (default 50MB), the app strips images from `extractedHtml`, retaining text content only and preserving original URLs as `data-original-src` attributes for lazy re-fetch.

#### Scenario: A recently-opened item is re-opened
- **WHEN** the user opens an item within 7 days of its first open
- **THEN** the cached `extractedHtml` with inlined images is rendered without any network fetch

#### Scenario: An item exceeds the full-retention window
- **WHEN** an item's first-open timestamp is more than 7 days ago
- **AND** the user opens the item
- **THEN** the cached `extractedHtml` is rendered with images stripped (text-only)
- **AND** each image placeholder carries `data-original-src`
- **AND** images are re-fetched lazily via `/img?url=` and re-inlined if the user scrolls near them

#### Scenario: Storage pressure triggers full eviction
- **WHEN** a feed's storage exceeds 50MB OR an item is older than 30 days
- **THEN** the app drops `extractedHtml` entirely from the item record
- **AND** the next open of that item triggers a fresh extraction via `/article?url=` and `/img?url=` as if it had never been opened

### Requirement: Reading view SHALL constrain text to a comfortable measure
The reading view body SHALL constrain article text width to approximately 65 characters (via `max-width` in CSS) regardless of viewport size. Images embedded in article HTML SHALL be allowed to overflow to the full content column width.

#### Scenario: A wide viewport is used
- **WHEN** the reading view is rendered on a viewport wider than the body's `max-width`
- **THEN** the article body column is centered and constrained to its `max-width`
- **AND** embedded images fill the column width

### Requirement: Reading view SHALL display only contextual chrome
In reading view, the top chrome SHALL show only a back affordance, the item source label and time, a star toggle, and an "Open original ↗" link. No sidebar, no river, and no folder navigation SHALL be visible in reading view.

#### Scenario: Reading view is shown
- **WHEN** the reading view takes over the viewport
- **THEN** the chrome displays: a back affordance, the source feed name + relative time, a star toggle, and an "Open original ↗" link
- **AND** the sidebar and river are not rendered

### Requirement: Extracted HTML SHALL be cached in IndexedDB
Once the app has successfully extracted an article's full text, the extracted HTML SHALL be stored on the item's record in IndexedDB. Subsequent opens of that item SHALL use the cached extraction.

#### Scenario: An item is extracted for the first time
- **WHEN** Readability produces extracted HTML for an item
- **THEN** the extracted HTML is stored on the item's record in IndexedDB and rendered

#### Scenario: An already-extracted item is reopened
- **WHEN** the user opens an item whose record contains cached extracted HTML
- **THEN** the reading view renders the cached HTML without invoking `/article` or Readability again

### Requirement: Mixed-content image failures SHALL be accepted as a v0 limitation
If the app is loaded over HTTPS and an extracted article body references HTTP image URLs, those images SHALL fail to load in the browser (mixed-content policy). The app SHALL render the image with a visible placeholder and the document's excerpt text SHALL remain fully legible. No server-side image proxy SHALL be used in v0.

#### Scenario: An extracted article references an HTTP image on an HTTPS app
- **WHEN** the reading view renders an extracted article whose body references an HTTP image URL
- **AND** the app is served over HTTPS
- **THEN** the image fails to load due to mixed-content policy
- **AND** the surrounding article text remains fully legible
- **AND** no server-side image proxy is invoked