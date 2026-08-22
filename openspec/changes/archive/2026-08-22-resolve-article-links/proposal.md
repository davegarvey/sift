## Why

Relative URLs in article `<a href>` links resolve against Sift's own origin (e.g., `localhost:8787`) instead of the original article's domain, causing broken links when clicked in the reading view.

## What Changes

- `processLinks()` in `src/articles/service.ts` will be extended to absolutize relative `href` values against the article's URL, using the same DOM-parsing / `new URL(href, base)` pattern already used by `inlineImages()` for images.
- The article URL (`item.link`) is already available at all three call sites and will be passed as the base URL.
- No changes to the server-side proxy, the database schema, or the UI components.

## Capabilities

### New Capabilities
- `article-link-resolution`: resolve relative `<a href>` URLs to absolute URLs against the article's canonical URL, across all content paths (feed HTML, cached extracted HTML, fresh extracted HTML).

### Modified Capabilities

- *(none)*

## Impact

- Only `src/articles/service.ts` is modified.
- No new dependencies. No schema migration. No API changes.
