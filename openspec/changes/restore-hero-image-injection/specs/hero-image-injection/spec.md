## ADDED Requirements

### Requirement: Inject hero image when extracted body has no images
When `extractArticle` produces HTML that contains zero `<img>` elements, the system SHALL inject a hero `<img>` element as the first child of `<body>`.

#### Scenario: OG image available
- **WHEN** the article HTML contains `<meta property="og:image" content="https://example.com/hero.jpg">` AND the Readability output contains no `<img>` elements
- **THEN** the returned HTML SHALL contain a hero `<img>` element whose `src` is `/img?url=<encoded-og-url>` and whose `data-original-src` is `https://example.com/hero.jpg`

#### Scenario: OG image unavailable, feed thumbnail used
- **WHEN** the article HTML has no `<meta property="og:image">` AND the feed item has a `thumbnail` AND the Readability output contains no `<img>` elements
- **THEN** the returned HTML SHALL contain a hero `<img>` element whose `src` is `/img?url=<encoded-thumbnail-url>` and whose `data-original-src` is the thumbnail URL

#### Scenario: Body already contains images
- **WHEN** the Readability output contains one or more `<img>` elements
- **THEN** the returned HTML SHALL NOT be modified with a hero image, regardless of whether `og:image` or a feed `thumbnail` is available

#### Scenario: No hero source available
- **WHEN** the article HTML has no `<meta property="og:image">` AND the feed item has no `thumbnail` AND the Readability output contains no `<img>` elements
- **THEN** the returned HTML SHALL be returned unmodified

#### Scenario: No network call for the hero image
- **WHEN** `extractArticle` injects a hero image
- **THEN** it SHALL NOT call `/img?url=` to fetch the image bytes — the `src` SHALL be the proxy URL string and the browser SHALL fetch the image when the reading view renders

### Requirement: OG image captured before Readability
When `extractArticle` parses the article HTML, it SHALL query `<meta property="og:image">` from the parsed document BEFORE calling `Readability.parse()`, because Readability strips `<head>`.

#### Scenario: OG image present in head
- **WHEN** the article HTML contains `<meta property="og:image" content="https://example.com/hero.jpg">` in `<head>`
- **THEN** `extractArticle` SHALL capture the URL `https://example.com/hero.jpg` for use as the hero image source

#### Scenario: OG image absent
- **WHEN** the article HTML has no `<meta property="og:image">` element
- **THEN** `extractArticle` SHALL fall through to the feed `thumbnail` parameter, and SHALL fall through to no hero if neither is present
