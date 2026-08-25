## Context

The CLI already has a direct XML fetcher and a sync API client. The sync API accepts optional bare `title`, `htmlUrl`, and `tags` fields, while the browser uses UUID feed IDs and stores those fields independently. The current CLI add path sends only URL/deletion fields, and its item parser always derives IDs from the URL.

## Goals / Non-Goals

**Goals:**

- Keep CLI-created subscriptions compatible with browser-created subscriptions.
- Give agents one feed metadata edit operation with explicit, deterministic fields.
- Preserve public, unauthenticated feed inspection through `items`.
- Make mutation output safe for shell and agent callers without changing the existing human-readable output contract.

**Non-Goals:**

- No sync schema or server route changes.
- No folder management; folders are deprecated in the browser data model.
- No item listing from server-side sync state, starring, unread toggles, or token revocation in this change.
- No feed discovery endpoint; add uses the existing direct feed fetch as best-effort metadata discovery.

## Decisions

### Best-effort metadata discovery on add

`feed add` will fetch and parse the supplied URL using the existing feed extractor. A successful parse contributes the feed title and HTML link for a new feed; an unsuccessful fetch or parse will not prevent subscription because the sync API has historically allowed adding feeds the server cannot fetch. Explicit `--title` and `--tags` values override discovered metadata. Re-adding an existing feed does not replace its existing metadata unless the caller explicitly supplies a value. This avoids making a network-dependent convenience step a requirement for the existing mutation.

The alternative was to require a successful feed parse, which would break adding private, temporarily unavailable, or server-only feeds and would contradict the existing add contract.

### One metadata edit command

`feed edit <url>` will accept `--title` and `--tags`, requiring at least one. It will pull once, resolve the live feed ID by exact URL, and push only fields supplied by the caller. An empty option value is meaningful and clears that field. Tags use the same normalization rules as the browser, keeping tag filtering and sync comparisons consistent.

The alternative was separate `feed title` and `feed tag` commands, which would duplicate URL resolution and make atomic metadata changes harder for agents.

### Stable item IDs with an anonymous fallback

When a token is available, `items` will use the feed ID returned by the sync pull for a matching live URL. When no token is available, it will retain direct public inspection and use the URL as the feed-ID fallback. The item parser will accept the selected feed ID rather than choosing one internally.

The alternative was to require pairing for every `items` call, which would remove a useful public-feed inspection mode and is unnecessary for read-only parsing.

### Mutation output and argument parsing

Mutation commands will share the existing exit-code model and add `--json` result objects. Flag parsing will remove recognized flags before positional validation, then reject leftovers. Human-readable output remains the default. JSON is emitted only after the server operation succeeds, so a failed mutation cannot look successful to an agent.

### Safe URL resolution for destructive operations

URL validation will happen before authentication or network calls. Removal and editing will require a live exact URL match from the pull; an unknown removal will report an error without creating a server tombstone. This prevents typos from accumulating inert feed rows while preserving the existing URL-based interface.

## Risks / Trade-offs

- **Metadata discovery adds a network request to `feed add`** → Keep it best-effort, bound it with a timeout, and continue the mutation when it fails.
- **A paired `items` call now performs a sync pull** → Only use the pull when a token is configured; unauthenticated inspection remains one direct request.
- **A feed URL may redirect or have multiple equivalent spellings** → Resolve exact stored URLs for this change; canonicalization is left for a separate contract so existing subscriptions are not unexpectedly merged.
- **Comma-separated tags cannot contain commas** → Match the browser's comma-as-delimiter input behavior and document the format.

## Migration Plan

No database migration or server deployment is required. Build and test the workspace package, publish it through the existing release workflow, and roll back by reverting the package release if necessary. Existing subscriptions remain unchanged; newly added or edited subscriptions receive the additional metadata fields.
