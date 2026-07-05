## Context

Sift currently has no client-side routing. The URL stays at `/` regardless of what the user is viewing. The `Item` model uses a composite primary key (`feedUrl::guid`) stored in IndexedDB. The app already has SPA fallback configured (Workbox `navigateFallback: '/index.html'` in the service worker, and `app.use('*', serveStatic(...))` in the production server) — so adding path-based routes requires no server changes.

## Goals / Non-Goals

**Goals:**

- Change the URL on article open so refresh restores the reading view
- Enable bookmarkable and shareable article URLs
- Include a cosmetic human-readable slug in the URL without relying on it for routing
- Preserve existing back-button-to-river behavior

**Non-Goals:**

- Client-side router library (not needed; history API directly is sufficient)
- Feed-scoped URLs (`/feed/<url>`) — the feed scope is already persisted via `lastFeedUrl` in IndexedDB settings
- Server-side changes of any kind
- Title-slug-based routing (the slug is cosmetic only)

## Decisions

### URL Format: `/i/<encoded-id>/<slug>`

**Pattern**: `/i/<base64url(compositeId)>/<slugified-title>`

Example: `/i/aHR0cHM6Ly9leGFtcGxlLmNvbS9mZWVkLnhtbDo6MTIzNDU/hello-world`

- **Encoded composite ID** (required, first path segment after `/i/`): The item's `feedUrl::guid` ID is base64url-encoded. This is stable and unique — the canonical routing key.
- **Title slug** (optional, second path segment): Generated from `item.title`. Ignored during routing. Improves readability when sharing/bookmarking. If excluded (e.g., old bookmarks), the route still resolves correctly from the ID alone.

Alternatives considered:
- **Query parameter** (`?item=<id>`): Works but looks less like a real URL, doesn't compose naturally with future routes.
- **Hash fragment** (`/#/item/<id>`): Hash is not sent to servers, and many social platforms strip hashes when sharing links. Path-based is better for shareability.
- **Raw ID in path** (`/i/<feedUrl>/<guid>`): Feed URLs can contain arbitrary characters (including slashes), making clean path encoding difficult without base64url or similar.

### Navigation and History Management

- **`openItem(item, replace?)`**: Uses `pushState` (default) or `replaceState` (when navigating between articles within the reading view). This keeps back-button semantics: each initial article open adds a stack entry, while prev/next within the view rewrites the current entry.
- **`closeReading()`**: After switching the view state to river, calls `history.back()` to return to the previous URL. The `popstate` listener checks `ctx.state.view` — since it's already `'river'`, the handler becomes a no-op.
- **Boot URL restoration**: After loading feeds/items from IndexedDB, the app inspects `location.pathname`. If it matches `/i/<encoded-id>`, it decodes the ID and calls `getItem(id)`. If the item exists, it sets the reading view directly. If not (evicted or stale bookmark), it silently falls through to the river view.

### Slug Generation

Simple slugify function in `routing.ts`:
- Lowercase, strip HTML tags, replace runs of non-alphanumeric chars (excluding hyphens) with `-`, collapse consecutive `-`, trim, truncate to 80 chars, strip trailing hyphens.

### File Structure

- **New `src/routing.ts`**: Pure functions — `encodeItemId`, `decodeItemId`, `slugify`, `itemUrl`, `parseItemIdFromUrl`. No state, no UI imports.
- **`src/state.tsx`**: Import routing helpers, update `openItem`/`closeReading`, add boot-time URL check.
- **`src/App.tsx`**: Minor popstate update.
- **`src/components/ReadingView.tsx`**: Change `navigate()` to pass `replace: true` to `openItem`.

## Risks / Trade-offs

- **Stale bookmarks**: A bookmarked article URL may point to an item that's been evicted or whose feed was unsubscribed. Mitigation: gracefully fall through to the river view (no error state).
- **Encoded ID readability**: Base64url is opaque. Users can't guess or hand-edit the ID. Mitigation: the title slug provides visual context; this is a deliberate trade-off for correctness.
- **Base64url length overhead**: ~33% increase over the raw composite ID. The ID is already compact (feed URL + `::` + guid), so this is negligible.
- **Slug conflicts**: Two articles could have the same slug. Mitigation: the slug is purely cosmetic. Routing always uses the encoded ID.

## Migration Plan

No migration needed — this is purely additive. Existing users will see URLs change when opening articles, and old `/` links continue to work.

## Open Questions

None.
