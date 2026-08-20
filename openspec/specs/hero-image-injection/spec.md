# hero-image-injection Specification

## Purpose
TBD - created by archiving change restore-hero-image-injection. Update Purpose after archive.

## Requirements

### Requirement: Inject hero image when extracted body has no images
When `extractArticle` produces HTML whose images do not include the hero image URL AND whose images are all banner-proportioned or absent, the system SHALL inject a hero `<img>` element as the first child of `<body>`. When the HTML contains any non-banner-proportioned `<img>`, the system SHALL NOT modify the HTML.

The hero URL SHALL be selected from a three-tier chain: (1) the `og:image` URL, absolutified against the article URL when relative; (2) if absent, the feed `thumbnail` URL; (3) if absent, the first high-signal image in the original document. A tier SHALL yield a URL only when it is an absolute `http(s)` URL; otherwise the chain SHALL fall through to the next tier, and SHALL yield no hero if no tier qualifies.

The high-signal image SHALL be the first `<img>` in document order, scanned BEFORE `Readability.parse()` is invoked (Readability mutates the document in place), with a parseable absolute `http(s)` `src` that has an ancestor `main`/`article` element, OR a `srcset` containing a `2x` descriptor token (matching `(?:^|\s)2x(?:\s|$)` — not a substring), OR `width` and `height` attributes both ≥ 200.

An existing `<img>` SHALL block injection only when it matches the hero URL: `data-original-src` SHALL be compared with exact string equality, and when `data-original-src` is absent the `/img?url=` src SHALL be stripped of its prefix and decoded with a non-throwing `decodeURIComponent` before comparison (a decode failure SHALL mean no match).

#### Scenario: OG image available, no images in body
- **WHEN** the article HTML contains `<meta property="og:image" content="https://example.com/hero.jpg">` AND the Readability output contains no `<img>` elements
- **THEN** the returned HTML SHALL contain a hero `<img>` element whose `src` is `/img?url=<encoded-og-url>` and whose `data-original-src` is `https://example.com/hero.jpg`

#### Scenario: Relative OG image absolutified
- **WHEN** the article HTML contains `<meta property="og:image" content="hero.jpg">` AND the article URL is `https://example.com/story/1`
- **THEN** the hero `data-original-src` SHALL be `https://example.com/story/hero.jpg` (and `src` SHALL be `/img?url=<encoded>`)

#### Scenario: Non-http(s) hero source falls through
- **WHEN** the article HTML contains `<meta property="og:image" content="data:image/png;base64,...">` AND the feed item has a `thumbnail` of `https://cdn.example.com/thumb.jpg`
- **THEN** the returned HTML SHALL contain a hero `<img>` element whose `data-original-src` is `https://cdn.example.com/thumb.jpg` (the `data:` URL SHALL NOT be used)

#### Scenario: OG image unavailable, feed thumbnail used
- **WHEN** the article HTML has no `<meta property="og:image">` AND the feed item has a `thumbnail` AND the Readability output contains no `<img>` elements
- **THEN** the returned HTML SHALL contain a hero `<img>` element whose `src` is `/img?url=<encoded-thumbnail-url>` and whose `data-original-src` is the thumbnail URL

#### Scenario: No OG image or thumbnail, high-signal in-page image used
- **WHEN** the article HTML has no `<meta property="og:image">` AND the feed item has no `thumbnail` AND the document scanned before `Readability.parse()` has its first image with a `2x` `srcset` descriptor as `https://imgs.xkcd.com/comics/comic_2x.png`
- **THEN** the returned HTML SHALL contain a hero `<img>` element whose `data-original-src` is `https://imgs.xkcd.com/comics/comic_2x.png`

#### Scenario: Body already contains the hero image
- **WHEN** the Readability output contains an `<img>` element whose `data-original-src` exactly equals the hero URL, or whose `/img?url=` src, stripped of its prefix and decoded (non-throwing; failure means no match), equals the hero URL
- **THEN** the returned HTML SHALL NOT be modified with a hero image

#### Scenario: Body contains non-banner images that are not the hero
- **WHEN** the Readability output contains one or more `<img>` elements that are not banner-proportioned AND none of them matches the hero URL
- **THEN** the returned HTML SHALL NOT be modified (no hero injected, even though the hero URL is absent from the body)

#### Scenario: Body contains the same picture under a different URL
- **WHEN** the Readability output contains a non-banner image of the same subject but with a different URL than the hero (e.g. a `_2x` variant or `?w=1200` resized CDN URL)
- **THEN** the system SHALL NOT attempt fuzzy matching AND SHALL NOT inject a hero (the variant is a non-banner image)

#### Scenario: Body contains only banner images that are not the hero
- **WHEN** the Readability output contains one or more `<img>` elements AND every one of them is banner-proportioned (`width` ≥ 300 AND `height` ≤ 150) AND none matches the hero URL
- **THEN** the returned HTML SHALL contain a hero `<img>` element as the first child of `<body>` whose `src` is `/img?url=<encoded-hero-url>` and whose `data-original-src` is the hero URL, AND SHALL NOT contain any of the banner-proportioned images

#### Scenario: No hero source available
- **WHEN** no tier yields an absolute `http(s)` hero URL
- **THEN** the returned HTML SHALL be returned unmodified

#### Scenario: No network call for the hero image
- **WHEN** `extractArticle` injects a hero image
- **THEN** it SHALL NOT call `/img?url=` to fetch the image bytes — the `src` SHALL be the proxy URL string and the browser SHALL fetch the image when the reading view renders

### Requirement: Remove banner-proportioned images only when a hero is injected
When a hero `<img>` was injected AND every remaining `<img>` in the output is banner-proportioned, the system SHALL remove those images. Images SHALL NOT be removed in any other case.

A banner-proportioned image SHALL be an `<img>` whose `width` attribute parses to an integer ≥ 300 AND whose `height` attribute parses to an integer ≤ 150; images with missing, non-numeric, or unit-suffixed attribute values SHALL NOT be classified as banner-proportioned.

#### Scenario: All output images are banners after hero injection
- **WHEN** a hero `<img>` is injected AND the Readability output contained only `<img src="..." width="520" height="100">` elements
- **THEN** the returned HTML SHALL contain the hero `<img>` and SHALL NOT contain the `width="520" height="100"` elements

#### Scenario: Mixed banner and non-banner images
- **WHEN** the Readability output contains a non-banner image (no hero injected, per the injection requirement) AND a `<img src="..." width="520" height="100">`
- **THEN** the returned HTML SHALL be unmodified (no images removed)

#### Scenario: Banner proportions require both attributes
- **WHEN** a hero `<img>` is injected AND the Readability output contains `<img src="..." width="520">` (no `height`), `<img src="..." width="520" height="100px">`, or `<img src="..." width="520" height="200">`
- **THEN** the returned HTML SHALL contain the hero `<img>` AND SHALL retain those images

#### Scenario: No hero injected, no images removed
- **WHEN** no hero `<img>` was injected AND the Readability output contains `<img src="..." width="520" height="100">` elements
- **THEN** the returned HTML SHALL be unmodified

### Requirement: OG image captured before Readability
When `extractArticle` parses the article HTML, it SHALL query `<meta property="og:image">` from the parsed document BEFORE calling `Readability.parse()`, because Readability strips `<head>`.

#### Scenario: OG image present in head
- **WHEN** the article HTML contains `<meta property="og:image" content="https://example.com/hero.jpg">` in `<head>`
- **THEN** `extractArticle` SHALL capture the URL `https://example.com/hero.jpg` for use as the hero image source

#### Scenario: OG image absent
- **WHEN** the article HTML has no `<meta property="og:image">` element
- **THEN** `extractArticle` SHALL fall through to the feed `thumbnail` parameter, and SHALL fall through to no hero if neither is present

### Requirement: Feed items SHALL store thumbnail URL
The feed parser SHALL extract `media:thumbnail` and `media:content` URLs from RSS feed entries and store the first available URL on the item record as a `thumbnail` field. If neither is present, `thumbnail` SHALL be `null`.

#### Scenario: Feed entry has a media:thumbnail element
- **WHEN** the feed parser processes an RSS entry containing `<media:thumbnail url="...">`
- **THEN** the thumbnail URL is extracted and stored on the item as `thumbnail`

#### Scenario: Feed entry has media:content with an image URL
- **WHEN** the feed parser processes an RSS entry containing `<media:content url="..." type="image/jpeg">`
- **THEN** the content URL is extracted and stored on the item as `thumbnail`

#### Scenario: Feed entry has neither media:thumbnail nor media:content
- **WHEN** the feed parser processes an RSS entry with no `<media:thumbnail>` or `<media:content>` elements
- **THEN** the item's `thumbnail` field is set to `null`