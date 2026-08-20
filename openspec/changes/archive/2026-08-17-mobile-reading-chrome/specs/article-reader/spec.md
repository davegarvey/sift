## MODIFIED Requirements

### Requirement: Embedded media SHALL fit the reading column width
During extraction, each `iframe`, `video`, and `embed` element SHALL be normalized so it renders within the reading column width without horizontal overflow, preserving its intrinsic aspect ratio. When the element has `width`/`height` attributes, the extracted element SHALL carry an inline style of `width:100%;height:auto;aspect-ratio:<w>/<h>`. When attributes are absent, the element SHALL fall back to `aspect-ratio:16/9`. In addition, the reading view CSS SHALL constrain `iframe`, `video`, and `embed` to `max-width:100%` as a safety net for any media the extractor does not process.

#### Scenario: Article contains a YouTube embed with width/height attributes
- **WHEN** extraction processes an article containing an `<iframe>` with `width="560"` and `height="315"`
- **THEN** the extracted iframe has inline `style="width:100%;height:auto;aspect-ratio:560/315"`
- **AND** the iframe renders fully inside the reading column with no horizontal overflow

#### Scenario: Embedded media without dimensions
- **WHEN** extraction processes an `<iframe>` or `<video>` with no `width`/`height` attributes
- **THEN** the element falls back to `aspect-ratio:16/9` with `width:100%;height:auto`

#### Scenario: Media not processed by the extractor
- **WHEN** the reading view renders article HTML containing an `iframe`, `video`, or `embed` that the extractor did not normalize
- **THEN** the CSS `max-width:100%` rule prevents it from overflowing the viewport
