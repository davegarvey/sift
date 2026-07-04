## ADDED Requirements

### Requirement: Prefer Open Graph image as hero image
When extracting an article and the extracted content contains no `<img>` elements, the system SHALL prefer the article's `<meta property="og:image">` as the hero image source over the feed's `<media:thumbnail>`.

#### Scenario: OG image available and fetch succeeds
- **WHEN** the article HTML contains `<meta property="og:image" content="https://example.com/hero.jpg">` and the image fetches successfully via `/img?url=`
- **THEN** the hero image SHALL be the data URI of `https://example.com/hero.jpg`

#### Scenario: OG image unavailable, feed thumbnail used
- **WHEN** the article HTML has no `<meta property="og:image">` but the feed item has a `thumbnail`
- **THEN** the hero image SHALL use the feed's thumbnail (existing behavior)

#### Scenario: OG image fetch fails
- **WHEN** the article HTML has `<meta property="og:image">` but fetching it as a data URI fails
- **THEN** the system SHALL fall back to the feed's `thumbnail` if available

#### Scenario: Neither source available
- **WHEN** neither `og:image` nor feed `thumbnail` is available
- **THEN** no hero image SHALL be injected
