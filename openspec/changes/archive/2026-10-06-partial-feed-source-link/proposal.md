## Why

Some publishers put only a short standfirst in `content:encoded` and append a self-link labeled `Source` instead of using a conventional “read more” CTA. Sift currently mistakes that payload for a full article, so the reader shows only the shortened feed excerpt and never attempts full-text extraction.

## What Changes

- Recognize self-links labeled `Source` as partial feed content when deciding whether to retain feed HTML.
- Fall back to the existing article extraction path for those entries.
- Add regression coverage using the Quanta-style RSS shape while preserving ordinary related/source links.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `article-reader`: Treat publisher feed entries that link back to the source article as partial content so the reader extracts the original article.

## Impact

- `src/feeds/parse.ts` partial-content detection and feed parsing tests.
- No API, database, dependency, or migration changes.
