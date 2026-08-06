## ADDED Requirements

### Requirement: First entry image becomes thumbnail fallback
When a feed entry provides no `media:thumbnail` and no `media:content`, the parser SHALL extract the first `<img src>` from the entry HTML source — `content:encoded`, then `content`, then the Atom `summary`, then the RSS `description` — absolutify it against the feed's URL, and store it as the item's `thumbnail`. The `src` attribute SHALL match either quote style (`"` or `'`). Summary and description values SHALL be unwrapped via the same `#text`/`_text`/`_cdata`/`$t` object-shape handling already used for `content` in `getExtraEntryFields`. HTML comments SHALL be stripped before matching. Sources that do not absolutify (invalid or unparseable URLs), srcset-only images, and entries whose summary/description parse to a nested element object with none of the `#text`/`_text`/`_cdata`/`$t` keys SHALL yield no thumbnail from the HTML source.

#### Scenario: Content-encoded image is used
- **WHEN** a feed entry has `content:encoded` containing `<img src="https://example.com/a.jpg">` AND no `media:thumbnail`
- **THEN** the parsed item SHALL have `thumbnail` set to `https://example.com/a.jpg`

#### Scenario: Escaped summary markup (nested `#text` object) is used
- **WHEN** a feed entry has no `content:encoded`, no `content`, AND its `<summary type="html">` escaped markup parses to `{"#text": "<img src=\"https://imgs.xkcd.com/comics/comic.png\" .../>"}` (the shape produced by fast-xml-parser for the live xkcd feed) AND no `media:thumbnail`
- **THEN** the parsed item SHALL have `thumbnail` set to `https://imgs.xkcd.com/comics/comic.png`

#### Scenario: RSS description image is used
- **WHEN** an RSS feed entry has no `content:encoded` AND its `<description>` contains `<img src="https://example.com/hero.jpg">` AND no `media:thumbnail`
- **THEN** the parsed item SHALL have `thumbnail` set to `https://example.com/hero.jpg`

#### Scenario: Relative and protocol-relative sources are absolutified
- **WHEN** the first `<img src>` is `/images/hero.jpg` or `//cdn.example.com/hero.jpg` AND the feed URL is `https://example.com/feed.xml`
- **THEN** the parsed item SHALL have `thumbnail` set to `https://example.com/images/hero.jpg` or `https://cdn.example.com/hero.jpg` respectively

#### Scenario: Single-quoted src matches
- **WHEN** the first `<img>` uses `src='https://example.com/a.jpg'`
- **THEN** the parsed item SHALL have `thumbnail` set to `https://example.com/a.jpg`

#### Scenario: No parseable src yields no thumbnail
- **WHEN** an entry has an `<img>` with only `srcset`, or a `src` that does not absolutify against the feed URL, or an image inside an HTML comment
- **THEN** the parsed item SHALL NOT have `thumbnail` set from the HTML source

#### Scenario: Media thumbnail wins
- **WHEN** a feed entry has a `media:thumbnail` AND an `<img>` in its HTML source
- **THEN** the parsed item SHALL have `thumbnail` set to the `media:thumbnail` URL

#### Scenario: Nested-object summary yields no thumbnail
- **WHEN** a feed entry's unescaped `<summary>` markup is parsed into a nested element object with none of the `#text`/`_text`/`_cdata`/`$t` keys AND it has no `content:encoded` and no `content`
- **THEN** the parsed item SHALL NOT have `thumbnail` set from the summary

### Requirement: Image-only summaries do not become full content (regression guard)
An image-only Atom `<summary>` SHALL NOT be stored as the item's `html`. Items whose only content source is a `summary` SHALL keep the current behavior: no `html` from the summary, `excerpt` is the tag-stripped summary text, and the reading view SHALL use the extraction path. This requirement exists to prevent the rejected "summary-as-content" alternative from being reintroduced.

#### Scenario: xkcd-style image-only summary does not set html
- **WHEN** a feed entry has no `content:encoded`, no `content`, and an image-only `<summary>` string containing `<img src="https://imgs.xkcd.com/comics/comic.png">`
- **THEN** the parsed item SHALL have `html` unset AND `thumbnail` set to the summary's image URL (per the thumbnail requirement)

#### Scenario: Text summary with image stays as-is
- **WHEN** a feed entry's `<summary>` contains an `<img>` element AND text outside the element
- **THEN** the parsed item SHALL have `html` unset from the summary and SHALL retain the current behavior (summary text only, extraction via Readability)
