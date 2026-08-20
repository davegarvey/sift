# Tasks

## 1. Feed parsing (thumbnail capture)

- [x] 1.1 Thread optional `baseUrl` into `parseFeed` (`src/feeds/parse.ts`) and pass it as `baseUrl` to `extractFromXml` (existing callers unaffected; scheduler.ts:136 and discover.ts:42 pass the feed URL)
- [x] 1.2 Add pure helper `firstImgSrc(html: string, baseUrl: string): string | undefined` — strips HTML comments, then first `<img src>` (either quote style), absolutified via `new URL(src, baseUrl)`; invalid/relative-unresolvable → undefined
- [x] 1.3 In `getExtraEntryFields`, set `_thumbnail` from `firstImgSrc` over the entry HTML source (`content:encoded` > `content` > `summary` > `description`) only when `pickThumbnail` found no `media:thumbnail`/`media:content`; unwrap object shapes via the existing `#text`/`_text`/`_cdata`/`$t` handling (live xkcd summaries are `{"#text": "<img ...>"}`); nested-object summaries (none of those keys) skipped
- [x] 1.4 Verify NO `_html` is ever set from `summary` or `description` (image-only or not) — feed HTML behavior unchanged
- [x] 1.5 Add tests to `tests/feeds.test.ts`: escaped-summary `{"#text": ...}` shape → `thumbnail` set, `html` unset (xkcd fixture); text+image summary unchanged; relative + protocol-relative src absolutified; single-quoted src; srcset-only → no thumbnail; `media:thumbnail` wins; nested-object summary → no thumbnail; RSS description image → `thumbnail` set; image inside HTML comment ignored

## 2. Hero rescue (extraction)

- [x] 2.1 Add pure helper `heroMatch(imgs: {src: string | null, originalSrc: string | null}[], heroUrl: string): boolean` — exact equality on `originalSrc`; for `src` missing `originalSrc`, strip `/img?url=` prefix then non-throwing `decodeURIComponent` (failure = no match)
- [x] 2.2 Add pure helper `isBannerImage(width: string | null, height: string | null): boolean` — integer-parse `width ≥ 300` AND `height ≤ 150`; missing/non-numeric/unit-suffixed → false
- [x] 2.3 Add pure helper `isHighSignal(img: {inMainArticle: boolean, srcset: string | null, width: string | null, height: string | null}): boolean` — `inMainArticle` OR `srcset` matches `(?:^|\s)2x(?:\s|$)` OR (width ≥ 200 AND height ≥ 200); node-testable predicate; DOM scan (ancestor `main`/`article`, document order) stays in `extractArticle`
- [x] 2.4 In `extractArticle`, scan the document for the in-page hero tier BEFORE `Readability.parse()` (Readability mutates the document in place — a post-parse scan sees a gutted body); absolutify og:image (`new URL(ogUrl, articleUrl)`); accept only absolute `http(s)` hero URLs (data:/javascript: fall through)
- [x] 2.5 Replace the any-`<img>` guard in `injectHeroImageProxy` (`src/articles/extract.ts`) with the three-step decision: (a) `heroMatch` inline → unmodified; (b) any non-banner image present → unmodified (containment gate); (c) else inject hero as first child of `<body>` and remove all-banner images
- [x] 2.6 Confirm cleanup removes images only under (c); confirm `rewriteImagesToProxy` ordering (runs before the guard) leaves width/height attrs intact
- [x] 2.7 Add helper tests: `heroMatch` (exact originalSrc match, decode-round-trip match, decode-failure → no match, missing src), `isBannerImage` (300×150 boundary, `520px`/`52px` non-numeric, missing attr), `isHighSignal` (2x token vs `comic_2x.png` substring, 200×200 boundary)
- [x] 2.8 Verify unchanged behavior: no network call for hero bytes, `og:image` preferred over thumbnail, healthy article with inline content images → byte-identical output

## 3. OpenSpec alignment

- [x] 3.1 Update `openspec/changes/restore-hero-image-injection/specs/hero-image-injection/spec.md` with the new semantics — keep the requirement NAME "Inject hero image when extracted body has no images" unchanged (MODIFIED delta supersedes it; a rename would leave the contradictory old requirement in place), update description + scenarios, add the new "Remove banner-proportioned images only when a hero is injected" requirement
- [x] 3.2 Update `openspec/changes/restore-hero-image-injection/design.md` Decisions section to match the new guard rule and hero source chain
- [x] 3.3 Note in the change summary that `improve-article-images`'s `hero-image-injection` spec (old any-img rule, data: URI wording) is superseded and slated for archival

## 4. Verification

- [x] 4.1 Run `npm test` (feed + helper tests pass, no regressions) — 171 tests pass, 19 files
- [x] 4.2 Run `npm run typecheck` and `npm run lint` — both clean
- [x] 4.3 Manual check: headless Chromium against live `https://xkcd.com/3281/` — hero chain resolves to the comic (og:image 2x), rescue fires, both 520×100 banner strips dropped; containment confirmed on BBC (18 content images → no rescue) and Wikipedia (no og:image → unchanged); visual check in `npm run dev` recommended
- [x] 4.4 Mention the `restore-hero-image-injection` spec divergence in the change summary

## 5. Verification follow-ups (post-verify)

- [x] 5.1 Add content:encoded-only thumbnail test (`CONTENT_IMG_RSS` in `tests/feeds.test.ts`) — closes WARNING 1
- [x] 5.2 Add `tests/hero-injection.test.ts` (jsdom, per-file env override) covering `injectHeroImageProxy` zero-image injection, inline-match no-op, containment gate, all-banner drop, unit-suffixed attrs — closes WARNING 2
- [x] 5.3 Export `heroFrom` and add unit tests (relative og:image absolutification, http(s)-only fall-through, thumbnail passthrough) — closes WARNING 3
