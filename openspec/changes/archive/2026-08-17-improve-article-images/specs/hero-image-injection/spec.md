## ADDED Requirements

### Requirement: Hero image SHALL be injected when Readability output has no images
When the extraction pipeline produces article HTML containing zero `<img>` elements, the system SHALL inspect the feed item for a `media:thumbnail` URL. If a thumbnail URL exists, the system SHALL fetch it via `GET /img?url=<encoded>` and inject a hero `<img>` element with the inlined `data:` URI at the top of the extracted HTML content, before any other elements.

If the thumbnail fetch fails, the article HTML SHALL be rendered without modification (no broken image).

#### Scenario: Readability output has no images and feed has a thumbnail
- **WHEN** `extractArticle` produces extracted HTML containing no `<img>` elements
- **AND** the feed item has a `media:thumbnail` URL
- **THEN** the thumbnail is fetched via `/img?url=` and inlined as a `data:` URI
- **AND** a hero `<img>` element with the inlined URI is prepended to the extracted HTML body
- **AND** the hero `<img>` carries `data-original-src` pointing at the original thumbnail URL
- **AND** the hero `<img>` is styled with `max-width: 100%` and `height: auto`

#### Scenario: Readability output already has images
- **WHEN** `extractArticle` produces extracted HTML containing at least one `<img>` element
- **THEN** no hero image is injected
- **AND** the extracted HTML is used as-is

#### Scenario: No thumbnail URL on the feed item
- **WHEN** the feed item has no `media:thumbnail` URL
- **THEN** no hero image is injected
- **AND** the extracted HTML is rendered without modification

#### Scenario: Thumbnail proxy fetch fails
- **WHEN** the `/img?url=` proxy returns a non-2xx status or a network error occurs for the thumbnail URL
- **THEN** no hero image is injected
- **AND** the extracted HTML is rendered without modification
- **AND** a warning is logged to `console.warn` with the thumbnail URL and error

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
