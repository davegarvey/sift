## ADDED Requirements

### Requirement: Relative article links resolve to absolute URLs
The system SHALL resolve relative `<a href>` values in article body HTML to absolute URLs using the article's canonical URL as the base.

#### Scenario: Relative path in feed-provided full content
- **WHEN** a feed item has full HTML content with `<a href="/about">` and the item's link is `https://example.com/blog/post`
- **THEN** the rendered link SHALL have `href="https://example.com/about"`

#### Scenario: Relative path in Readability-extracted content
- **WHEN** an article is extracted via Readability and contains `<a href="../page">` and the article URL is `https://example.com/blog/post`
- **THEN** the rendered link SHALL have `href="https://example.com/page"`

#### Scenario: Hash fragment in link
- **WHEN** an article link is `<a href="#section">` and the article URL is `https://example.com/page`
- **THEN** the rendered link SHALL have `href="https://example.com/page#section"`

#### Scenario: Already-absolute URL unchanged
- **WHEN** an article link has an absolute URL like `<a href="https://other.com/page">`
- **THEN** the href value SHALL remain `https://other.com/page`

#### Scenario: Protocol-relative URL resolved
- **WHEN** an article link is `<a href="//cdn.example.com/image.png">` and the article URL is `https://example.com/page`
- **THEN** the rendered link SHALL have `href="https://cdn.example.com/image.png"`

#### Scenario: Mailto link unchanged
- **WHEN** an article link is `<a href="mailto:user@example.com">`
- **THEN** the href value SHALL remain `mailto:user@example.com`

#### Scenario: Invalid URL left as-is
- **WHEN** an article link has a malformed href that cannot be parsed
- **THEN** the href value SHALL be left unchanged

### Requirement: Links open in new tab with security attributes
The system SHALL ensure all `<a>` tags in article body HTML have `target="_blank"` and `rel="noopener noreferrer"`.

#### Scenario: Link without target or rel
- **WHEN** an article contains `<a href="https://example.com">text</a>`
- **THEN** the rendered link SHALL have `target="_blank"` and `rel="noopener noreferrer"`

#### Scenario: Link with existing target preserved
- **WHEN** an article contains `<a href="https://example.com" target="_self">text</a>`
- **THEN** the rendered link SHALL have `target="_blank"` (overridden) and `rel="noopener noreferrer"`
