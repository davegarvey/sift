## MODIFIED Requirements

### Requirement: Command palette search is debounced
The command palette SHALL debounce search queries so that a full IndexedDB scan does not fire on every keystroke. In-flight searches SHALL be cancellable via AbortController when a new query arrives before the previous one completes. The scan SHALL read article records only, without `html` or `extractedHtml`, and SHALL match the query as a substring of the title or excerpt.

#### Scenario: Rapid keystrokes produce one search
- **WHEN** the user types three characters within 200ms
- **THEN** only one search query is dispatched (after the debounce window expires)

#### Scenario: Subsequent keystroke cancels in-flight search
- **WHEN** a search is in-flight (scanning items) and the user types an additional character
- **THEN** the in-flight search SHALL be aborted via AbortController

#### Scenario: Search matches metadata and loads no bodies
- **WHEN** a search runs over articles that have stored bodies
- **THEN** results SHALL be the articles whose title or excerpt contains the query
- **AND** the returned records SHALL contain neither `html` nor `extractedHtml`
