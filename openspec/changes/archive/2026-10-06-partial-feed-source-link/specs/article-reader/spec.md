## ADDED Requirements

### Requirement: Self-referential source links identify partial feed content

When feed HTML contains a link labeled `Source` that resolves to the item's own article URL, the feed parser SHALL classify the HTML as partial content so the reader can use the article extraction path. A `Source` link to a different URL SHALL NOT by itself classify otherwise complete feed HTML as partial.

#### Scenario: Quanta-style source link
- **WHEN** an entry's feed HTML contains a short body and a `Source` link to the entry's article URL
- **THEN** the parser SHALL not store that HTML as full article content
- **AND** the reader SHALL be able to request full-text extraction from the article URL

#### Scenario: External source link
- **WHEN** complete feed HTML contains a `Source` link to a different URL
- **THEN** the parser SHALL not classify the HTML as partial solely because of that label

#### Scenario: Existing full-article CTA
- **WHEN** feed HTML ends with an existing full-article CTA such as `Read full article`
- **THEN** the parser SHALL continue to classify the HTML as partial content
