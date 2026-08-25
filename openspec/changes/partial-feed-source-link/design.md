## Context

`parseFeed` stores `content:encoded` as item HTML unless `isPartialFeedContent` recognizes a terminal full-article call to action. Quanta's RSS entries contain a short paragraph followed by a link whose text is `Source` and whose URL is the item's own article URL. The reader treats that HTML as complete and therefore skips `extractArticle`.

## Goals / Non-Goals

**Goals:**

- Detect self-referential source links as partial content.
- Keep links to related or external source material from triggering extraction.
- Preserve the existing full-content and CTA detection behavior.

**Non-Goals:**

- No change to the article proxy or Readability extraction itself.
- No publisher-specific Quanta URL handling.
- No change to feed excerpts or RSS fetching.

## Decisions

Add `source` to the recognized partial-content labels, but apply it only when the link resolves to the current article URL. This handles Quanta's feed shape while avoiding false positives for an ordinary article that cites an external source.

The existing `articleUrl`-optional behavior remains unchanged: without an article URL, the label still identifies partial content, matching the current CTA helper contract.

## Risks / Trade-offs

- **A full article may end with a self-link labeled `Source`** → Prefer the extraction path in that ambiguous case; the original article remains available through the same URL and existing Readability fallback.
- **Publisher labels vary** → Keep this change focused on the observed self-link shape; additional labels can be added with separate fixtures if needed.

## Migration Plan

No migration or deployment coordination is required. Ship the parser and regression test with the normal web application release.
