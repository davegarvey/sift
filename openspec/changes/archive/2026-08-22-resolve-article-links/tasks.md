## 1. Modify `processLinks` to resolve relative URLs

- [x] 1.1 Change `processLinks` signature to accept optional `baseUrl: string` parameter
- [x] 1.2 Use `DOMParser` to parse HTML and iterate `<a href>` elements (same pattern as `inlineImages`)
- [x] 1.3 For each `<a>` with an `href`, absolutize relative URLs via `new URL(href, baseUrl)` wrapped in try/catch
- [x] 1.4 Preserve existing `target="_blank"` and `rel="noopener noreferrer"` logic
- [x] 1.5 Return serialized `doc.body.innerHTML`

## 1b. Prevent Readability from wrongly absolutizing URLs

- [x] 1.6 Discover that Readability's `_fixRelativeUris` already absolutizes `<a href>` using `this._doc.baseURI` which defaults to Sift's page origin — not the article URL
- [x] 1.7 Inject `<base href="articleUrl">` into the document before passing to Readability, so `_fixRelativeUris` resolves against the correct base

## 1c. Handle cached HTML with wrongly-absolutized URLs

- [x] 1.8 In `processLinks`, detect URLs that are absolute but point to `window.location.origin` instead of the article's origin, and re-resolve them against the article URL

## 2. Pass article URL at all three call sites

- [x] 2.1 Pass `item.link` as `baseUrl` to `processLinks` at path 1 (feed HTML, line 45)
- [x] 2.2 Pass `item.link` as `baseUrl` to `processLinks` at path 2 (cached extracted HTML, line 50)
- [x] 2.3 Pass `item.link` as `baseUrl` to `processLinks` at path 3 (fresh extracted HTML, line 63)

## 3. Verify

- [x] 3.1 Run `npm run typecheck` — zero errors
- [x] 3.2 Run `npm run lint` — verified pre-existing error in `.opencode/plugins/crit.ts` not from our changes
- [x] 3.3 Run `npm test` — all 18 tests pass
- [ ] 3.4 Run `npm run dev` and manually verify relative links resolve correctly in reading view
