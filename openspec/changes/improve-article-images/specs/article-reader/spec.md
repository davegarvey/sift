## MODIFIED Requirements

### Requirement: Article images SHALL be inlined as data: URIs in cached extracted HTML
During extraction, each `<img>` element's source SHALL be fetched via `GET /img?url=<encoded>` and inlined as a `data:` URI inside the cached `extractedHtml`. The original image URL SHALL be preserved as a `data-original-src` attribute so that re-extraction after eviction can re-fetch lazily.

Relative image URLs SHALL be resolved against the original article URL, not the Sift app URL. When the proxy fetch fails or returns a non-2xx status, the `<img>` SHALL have its `src` attribute removed (no broken HTTP URL left in place) while retaining `data-original-src` for potential future re-inline. If the upstream response has no `Content-Type` header, the inlined data: URI SHALL use `image/png` only as a last resort fallback.

Image fetch failures SHALL produce a `console.warn` message including the original URL and HTTP status or error reason.

#### Scenario: An extracted article body contains images
- **WHEN** the reading view renders extracted article HTML containing `<img>` elements
- **THEN** each `<img>` element's `src` is a `data:` URI produced by fetching the original image via `/img?url=`
- **AND** each `<img>` element retains `data-original-src` pointing at the original URL

#### Scenario: Image proxy fetch fails
- **WHEN** the `/img?url=` proxy returns a non-2xx status or a network error occurs
- **THEN** the `<img>` element's `src` attribute is removed
- **AND** the `data-original-src` attribute retains the original URL
- **AND** a warning is logged to `console.warn` with the original URL and error

#### Scenario: Relative image URL resolution
- **WHEN** the extracted article contains an `<img>` with a relative `src` (e.g., `/images/photo.jpg`)
- **THEN** the relative URL SHALL be resolved against the original article URL (e.g., `https://example.com/article`)
- **AND** the resulting absolute URL SHALL be used for the `/img?url=` proxy fetch

#### Scenario: Upstream image response has no Content-Type
- **WHEN** the upstream image server returns a 2xx response without a `Content-Type` header
- **THEN** the data: URI SHALL omit the MIME type or use `application/octet-stream`
- **AND** the browser SHALL infer the type from the image bytes

## REMOVED Requirements

### Requirement: Mixed-content image failures SHALL be accepted as a v0 limitation
**Reason**: The `/img?url=` server-side proxy is now fully implemented and operational. Mixed-content HTTP images are fetched via the proxy and inlined as safe `data:` URIs, so this limitation no longer applies. The contradictory requirement that prohibited a server-side proxy is removed.
**Migration**: All mixed-content images are now handled by the existing proxy. No migration needed.
