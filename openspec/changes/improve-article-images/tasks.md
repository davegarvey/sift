## 1. Bug fixes in image-inlining pipeline

- [x] 1.1 Fix MIME fallback in `fetchImageAsDataUri`: change `'image/png'` to omit type when `blob.type` is empty
- [x] 1.2 Add `console.warn` logging in `fetchImageAsDataUri` for non-2xx responses and network errors, including original URL and status/reason
- [x] 1.3 Fix `inlineImages` to resolve relative URLs against article URL: add `articleUrl` parameter, use it as base instead of `document.baseURI`
- [x] 1.4 Fix `inlineImages` to remove `src` when `fetchImageAsDataUri` returns null (instead of leaving original URL intact)
- [x] 1.5 Thread `articleUrl` through `extractArticle` and `openItemForReading` so `inlineImages` receives the article URL
- [x] 1.6 Run `npm run typecheck` and `npm run lint` to verify no regressions

## 2. Add thumbnail field to Item schema and feed parser

- [x] 2.1 Add `thumbnail?: string | null` to the `Item` interface in `src/db/types.ts`
- [x] 2.2 Extract `media:thumbnail` and `media:content` URLs in `parseFeed`'s `getExtraEntryFields` callback, store as `_thumbnail` on the entry
- [x] 2.3 Map `_thumbnail` to `thumbnail` in `mapEntry` and `parsedToItems`
- [x] 2.4 Run `npm run typecheck` and `npm run lint`

## 3. Hero image injection

- [x] 3.1 Create `injectHeroImage(html: string, thumbnailUrl: string): Promise<string>` helper that fetches thumbnail via `/img?url=`, inlines as data: URI, and prepends a styled `<img>` element with `data-original-src`
- [x] 3.2 Integrate hero injection into `extractArticle`: after `inlineImages`, count `<img>` elements in the result; if zero and a thumbnail URL is available, call `injectHeroImage`
- [x] 3.3 Wire thumbnail URL through `openItemForReading` and into `extractArticle`
- [x] 3.4 Run `npm run typecheck` and `npm run lint`
- [x] 3.5 Run `npm test` to ensure existing tests pass
