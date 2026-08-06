## Why

The xkcd feed (https://xkcd.com/atom.xml) renders without its cartoon: the feed's image-only Atom `<summary>` carries no usable thumbnail, Readability drops the comic entirely (image-only containers are structurally invisible to its text-scoring algorithm), and the hero-image guard refuses to inject the og:image because Readability kept two unrelated footer banners. The same failure class (content images dropped by Readability) is documented upstream for a decade — even Firefox Reader Mode — so the fix must be layered on top of Readability in Sift's own pipeline.

## What Changes

- Feed parsing (`src/feeds/parse.ts`): capture the first `<img src>` from the entry HTML source (`content:encoded` > `content` > Atom `summary` > RSS `description`) as the item `thumbnail` when no `media:thumbnail`/`media:content` exists. Absolutified against the feed URL; the `#text`-object shape used by live xkcd summaries is unwrapped. No behavioral change to `item.html` — image-only summaries are NOT treated as full content (avoids the teaser-regression class).
- Article extraction (`src/articles/extract.ts`): replace the "any `<img>` blocks hero injection" guard with a URL-match guard plus a containment gate — inject the hero only when the output contains no non-banner image. The hero source chain becomes: `og:image` (absolutified, `http(s)` only) → feed `thumbnail` → first high-signal in-page image (inside `main`/`article`, a `2x` `srcset` descriptor, or large `width`/`height` attributes), scanned before Readability runs.
- Article extraction: when a hero is injected and every remaining output image is banner-proportioned (`width ≥ 300` and `height ≤ 150` attributes), remove them — e.g. xkcd's footer strips.

## Capabilities

### New Capabilities
- `feed-image-thumbnails`: The first image in a feed entry's HTML source (content, summary, or description) becomes the item's thumbnail when no `media:thumbnail`/`media:content` is present, absolutified against the feed URL. Image-only summaries SHALL NOT become full content (regression guard).

### Modified Capabilities
- `hero-image-injection` (delta spec in `restore-hero-image-injection`): the "body already contains images" requirement changes from "any `<img>` blocks injection" to "an `<img>` matching the hero URL, or any non-banner `<img>`, blocks injection"; hero source chain extended; banner-proportioned images removed only when a hero is injected and all output images are banner-proportioned.

## Impact

- `src/feeds/parse.ts` — `getExtraEntryFields` hook + `firstImgSrc` helper; optional `baseUrl` parameter threaded into `parseFeed`.
- `src/articles/extract.ts` — `injectHeroImageProxy` guard logic, hero source chain, banner cleanup (pure helpers `heroMatch`, `isBannerImage`, `isHighSignal` for node testability).
- `tests/feeds.test.ts` — new Atom/RSS samples (summary `#text` shape → thumbnail; text+image summary unchanged; absolutification cases; media wins; nested-object summary).
- OpenSpec: update `openspec/changes/restore-hero-image-injection/specs/hero-image-injection/spec.md` + `design.md`.
- No README changes; no server/proxy changes; no `item.html` behavior changes.
