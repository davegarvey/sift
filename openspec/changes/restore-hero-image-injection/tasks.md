## 1. Capture og:image before Readability

- [x] 1.1 In `extractArticle`, after parsing the article HTML into a DOM document, query `doc.querySelector('meta[property="og:image"]')?.getAttribute('content')` and save as `ogUrl`
- [x] 1.2 Confirm the query runs BEFORE the `new Readability(doc).parse()` call

## 2. Implement proxy-based hero injection

- [x] 2.1 Add a private `injectHeroImageProxy(html: string, heroUrl: string): string` helper in `extract.ts`
- [x] 2.2 The helper: parse HTML, return input unchanged if `body.querySelector('img')` exists, otherwise insert a new `<img src="/img?url=<encoded>" data-original-src="<absolute>" style="max-width:100%;height:auto;display:block;margin:0 auto 1em">` as the first child of `<body>` and return `body.innerHTML`
- [x] 2.3 In `extractArticle`, compute `heroUrl = ogUrl ?? thumbnailUrl` and call `injectHeroImageProxy(rewritten, heroUrl)` only when `heroUrl` is truthy
- [x] 2.4 Do NOT call `fetchImageAsDataUri` — the proxy URL is enough; the browser fetches on render

## 3. Verify

- [x] 3.1 Run `npm run typecheck` — zero errors
- [x] 3.2 Run `npm run lint` — zero new warnings
- [x] 3.3 Run `npm test` — all 22 tests pass
- [x] 3.4 Manual: open a BBC article in `npm run dev` and confirm a hero image appears at the top of the reading view
