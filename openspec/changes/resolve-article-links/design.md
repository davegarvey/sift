## Context

Article content displayed in Sift's reading view can contain `<a>` tags with relative `href` values (e.g., `/about`, `../page`, `section#anchor`). Since Sift serves this content from its own origin, clicking these links navigates to `sift-origin/about` instead of the original article's domain, resulting in a broken navigation that shows the main listing page.

The codebase already has a pattern for resolving relative URLs: `inlineImages()` in `extract.ts` uses `new URL(src, base)` to absolutize image `src` values. The same technique needs to be applied to `<a href>`.

## Goals / Non-Goals

**Goals:**
- All `<a href>` values in article body HTML are absolute URLs before rendering
- Relative URLs resolve against the article's canonical URL (`item.link`)
- The fix covers all three content paths (feed HTML, cached extracted HTML, fresh extracted HTML)
- Links open in new tabs with `rel="noopener noreferrer"` (existing behavior preserved)

**Non-Goals:**
- Not resolving links in article metadata, excerpts, or other non-body content
- No changes to the server-side proxy (`/article`, `/img`, `/feed`)
- No schema changes or data migration
- No changes to the image inlining/eviction system

## Decisions

**Use DOMParser + `new URL()` (same pattern as `inlineImages`) rather than regex.**
- *Alternatives considered:* regex replacement on `href` attributes — fragile, error-prone with edge cases (quoted attributes, unicode URLs, etc.).
- The existing `inlineImages()` function already proves this pattern works in this codebase.

**Modify `processLinks()` in `service.ts` to accept a `baseUrl` parameter.**
- *Alternatives considered:* creating a separate function called alongside `processLinks()` — unnecessary; `processLinks()` already touches every `<a>` tag and is called at all three paths.
- This keeps the change minimal: one function signature change, three parameter additions.

**Use `item.link` as the base URL in all three paths.**
- *Alternatives considered:* storing the article URL at extraction time — not needed; `item.link` is always available and is the correct base for both feed-provided and extracted content.

## Risks / Trade-offs

- **Parse-serialize overhead** → Each `processLinks()` call now parses and serializes the HTML. This is the same cost `inlineImages()` already pays, and article body sizes are small enough that the overhead is negligible.
- **Invalid URLs in href** → `new URL()` throws on truly malformed URLs; wrapped in try/catch so invalid hrefs are left as-is.
- **`javascript:` and `data:` URIs** → These have schemes and are treated as absolute URLs by `new URL()`, so they pass through unchanged. Correct behavior.
