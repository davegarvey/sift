## Context

The app has a working `/img?url=` server-side proxy that fetches upstream images and pipes them back. However, the browser-side image-inlining pipeline has three bugs that silently drop or break images, and Readability often strips all `<img>` elements from certain publishers' articles (e.g. BBC News), producing image-free extracted HTML.

The existing behavior:
- `fetchImageAsDataUri` (`src/feeds/fetch.ts`) fetches via proxy, converts to base64, returns null on any failure (silently)
- `inlineImages` (`src/articles/extract.ts`) resolves relative URLs against `document.baseURI`, fetches each image via proxy, replaces src with data: URI — but on failure leaves the original src intact
- `extractArticle` (`src/articles/extract.ts`) calls `inlineImages` on Readability output
- `openItemForReading` (`src/articles/service.ts`) has three paths: cached extractedHtml, feed html, or extraction

## Goals / Non-Goals

**Goals:**
- Fix the three image-inlining bugs (mixed-content src leak, wrong relative URL base, wrong MIME fallback)
- Add `console.warn` logging for image fetch failures so they're observable
- Inject a hero image from `media:thumbnail` when Readability output has no images
- Store `thumbnail` on items from feed metadata

**Non-Goals:**
- Lazy re-inline on scroll (already spec'd but not wired — deferred)
- Eviction scheduling (already spec'd but not wired — deferred)
- Handling video content or `<picture>` elements beyond `<img>`
- Any server-side changes (proxy works correctly)

## Decisions

### D1: Remove `src` on image fetch failure (keep `data-original-src`)

**Why:** Leaving the original HTTP `src` causes mixed-content blocking in HTTPS contexts and shows a broken-image icon. Removing `src` causes the browser to render nothing for that `<img>` slot (alt text is still visible). The `data-original-src` is preserved for potential re-inline later.

**Alternative considered:** Setting `src` to a transparent 1x1 GIF data: URI would hide the failure but would be misleading and consume space. Removing `src` is honest and minimal.

### D2: Pass article URL as base for relative URL resolution

`inlineImages` currently resolves relative image URLs against `document.baseURI` (the Sift app URL). Instead, `extractArticle` SHALL pass the article's URL (from `item.link`) down to `inlineImages`, which SHALL use it as the base when calling `new URL(src, base)`.

**Why:** The article URL is the correct origin for relative URLs. `document.baseURI` points at the Sift app, which is wrong for any relative image path.

**Alternative considered:** Adding a `<base>` tag to the rendered HTML — this would affect all relative URLs in the page, not just images, and could break other things.

### D3: Omit MIME type when upstream has no Content-Type

When `blob.type` is empty, the current code falls back to `'image/png'`. Instead, omit the type entirely (`data:;base64,...`) and let the browser infer from bytes. Browsers handle this correctly for common image formats (JPEG, PNG, GIF, WebP).

**Why:** Hardcoding `image/png` produces data: URIs with a misleading MIME type for JPEG/GIF/WebP content, which some browsers may reject.

**Alternative considered:** Content sniffing (magic bytes: `\xFF\xD8\xFF` = JPEG, `\x89PNG` = PNG, etc.) — more accurate but adds complexity and edge cases. Browsers already handle type-omitted data: URIs well.

### D4: Hero image injection in `extractArticle`, not in service layer

The injection SHALL happen inside `extractArticle` (or a helper called from it) rather than in `openItemForReading`. This keeps the caching behavior intact: the injected hero image is part of `extractedHtml` stored in IndexedDB, so it persists across sessions and survives eviction.

**Why:** If injection happened at render time, it would be ephemeral — lost on reopen, not available offline, and inconsistent between cache states.

### D5: Extract `thumbnail` in the feed parser from `media:thumbnail`

The feed parser `parse.ts` currently extracts `content:encoded` via `getExtraEntryFields`. A similar approach SHALL extract `<media:thumbnail url="...">` and `<media:content url="..." type="image/*">` from the raw entry, with priority to `media:thumbnail`. The value SHALL be stored as `thumbnail` on the `Item` record.

**Why:** The feed is the most reliable source for the article's hero/thumbnail image. The RSS `<media:thumbnail>` element is the standard way feeds supply images.

**Alternative considered:** Extracting `<og:image>` from the article HTML — this would require a separate fetch and parse for every article, which is expensive.

## Risks / Trade-offs

- **[Risk] BBC CDN blocks proxy requests** → The `/img?url=` proxy uses a descriptive User-Agent and has a 15-second timeout. If BBC's image CDN rejects the proxy's requests, the hero image fetch will also fail. This is no worse than the current state (no images) and is observable via `console.warn` after this change. A future improvement could forward a browser-like User-Agent or use a dedicated image CDN.
- **[Risk] `media:thumbnail` URL may be HTTP** → The proxy already handles HTTP URLs, so this is not a new concern.
- **[Risk] Hero image duplicates images across feeds** → Only injected when Readability output has zero `<img>` elements. This avoids duplication entirely.
- **[Trade-off] MIME type omission** → Omitting type from data: URIs is well-supported in modern browsers but may behave differently in older ones. Given this app targets modern browsers (ES modules, `esnext` target), this is acceptable.
