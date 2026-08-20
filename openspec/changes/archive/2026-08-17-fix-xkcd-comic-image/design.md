## Context

Sift's article pipeline has three stages: feed parse (`src/feeds/parse.ts` via `@extractus/feed-extractor`), article extraction (`src/articles/extract.ts` via `@mozilla/readability` + the `/img?url=` proxy rewrite), and rendering (`openItemForReading` in `src/articles/service.ts`, which prefers cached/feed HTML over extraction).

The xkcd Atom feed (`https://xkcd.com/atom.xml`) exposes each comic as an image-only `<summary type="html"><img .../></summary>` — no `content`, no `content:encoded`, no `media:thumbnail`. Verified against the live feed: `parseFeed` produces `html: undefined`, `thumbnail: null`, `excerpt: ""`. Readability then drops the comic (output is only the two 520×100 footer banner strips), and the hero guard at `extract.ts:68` (`if (doc.body.querySelector('img')) return html;`) suppresses the og:image rescue because those banners count as images.

### Research findings (why this is designed as a layered rescue)

- Readability scores only elements whose `innerText` is ≥ 25 chars (hardcoded in the scoring loop, `Readability.js` ~line 1225); `alt`/`title` attributes are not text content, so image-only containers (`#comic`) are structurally invisible to the algorithm. No constructor option affects this (`charThreshold` only gates whole-article length at ~line 1546; `nbTopCandidates`, `keepClasses` are unrelated).
- This is a decade-old, well-known problem class upstream: open issues since 2016 (medium.com #299, The Verge #427, NYT #678, Pokémon multi-image pages #771, image lists #697). Firefox Reader Mode exhibits the same behavior. The maintainers' own `<figure>`-image PR (#989) remains unmerged after a year.
- Conclusion: the fix cannot live inside Readability (or a fork of it); it must be layered on top, in Sift's own pipeline, which has the original document and og:image available during `extractArticle`. Note: this Readability version mutates the document in place (`this._doc = doc`, no clone), so any scan of the original document MUST happen before `Readability.parse()`.

### Containment property (the primary regression guard)

**The rescue fires ONLY when Readability's output contains no real content image** (zero `<img>` elements, or only banner-proportioned ones). Any article whose extraction already produced at least one non-banner image gets byte-identical output to today — no hero injected, no image removed, no thumbnail effect. The change therefore cannot alter the rendering of any article whose extraction currently works; its blast radius is confined to already-failed extractions (which today render junk or nothing).

Constraints: tests run in node (`environment: 'node'` in `vitest.config.ts`, no jsdom), so DOMParser-based code is verified manually or via extracted pure helpers. `restore-hero-image-injection` is an active OpenSpec change whose spec currently mandates "no injection when the body contains any `<img>`" — this change modifies that requirement (same requirement name, new semantics).

## Goals / Non-Goals

**Goals:**
- xkcd (and similar image-first pages) render their actual content image.
- The hero guard stops defeating og:image injection when Readability keeps only junk images.
- The fix is general, additive, contained (see above), and node-testable where possible.

**Non-Goals:**
- No changes to `/img` proxy, server, storage schema, or eviction.
- No proxying/rewriting of feed-HTML images (Path 1 renders feed HTML as-is today; out of scope).
- No changes to `srcset` rewriting.
- No retroactive re-extraction of already-cached items.
- No fuzzy image matching (same picture under a 2x/resized URL).
- **No feed-level content changes**: image-only Atom summaries are NOT treated as `item.html` (a permanent, unrecoverable regression for teaser-style feeds); the feed image becomes a thumbnail fallback instead.
- **No content-image rescue** (rescuing every dropped inline figure for multi-image articles, e.g. the Pokémon case): needs corpus validation, deferred to a follow-up change.

## Decisions

### D1: Rescue at the extraction layer, not the feed layer

The general mechanism is a post-extraction hero rescue inside `extractArticle`: determine a hero URL from a three-tier chain — `og:image` (absolutified against the article URL via `new URL(ogUrl, articleUrl)`), then the feed `thumbnail`, then the first high-signal in-page image — and inject it as the first child of the extracted body when the output contains no real content image.

**Why:** This single mechanism covers the whole failure class: Readability output with zero images (BBC case, fixed today), output with only junk images (xkcd case, blocked today), and image-first pages without og:image. It is strictly more general than any feed-level heuristic.

**Hero URL validity:** each tier yields a URL only when it is an absolute `http(s)` URL after absolutification; anything else (e.g. `data:`/`javascript:` og:image, unresolvable relative) falls through to the next tier. This prevents broken `/img?url=data:...` heroes (the proxy cannot fetch data: URIs).

**High-signal in-page image** (third tier): the first `<img>` in document order with a parseable absolute `http(s)` src that either (a) has an ancestor `main`/`article` element, (b) has a `srcset` containing a `2x` descriptor token (regex `(?:^|\s)2x(?:\s|$)`, not a substring like `comic_2x.png`), or (c) has `width` and `height` attributes both ≥ 200. xkcd's comic has no width/height attrs but carries a `2x` srcset, so (b) selects it while the 520×100 banners and the 185×83 logo fail all three tests. **This scan SHALL run on the document BEFORE `Readability.parse()`**, because Readability mutates the document in place; scanning afterwards yields a gutted body.

**Alternatives considered:**
- Treat image-only Atom summaries as `item.html` (earlier design): renders xkcd perfectly (comic only) but is a permanent, unrecoverable regression for feeds whose image-only summary is a teaser — `bulkUpsertItems` nulls `extractedHtml` on every refresh when `html` is present, so the extracted article can never return. Rejected: heuristic with a permanent downside for other feeds.
- Seed-text enrichment (inject alt text into image-only containers before Readability so they become scorable): potentially fixes multi-image articles in place, but changes Readability's candidate pool for *every* article — violates the containment property. Deferred; flagged in Open Questions.
- Content-image rescue (diff original-page images against output): fixes multi-image articles but needs junk-aversion heuristics that require corpus validation. Deferred.

### D2: Capture the first entry image as thumbnail

When `pickThumbnail` finds no `media:thumbnail`/`media:content`, extract the first `<img src="...">` (either quote style) from the entry HTML source — `content:encoded` > `content` > Atom `summary` > RSS `description` — and set `_thumbnail`, absolutified against the feed URL. The summary/description values SHALL be unwrapped via the same `#text`/`_text`/`_cdata`/`$t` shape handling already used at parse.ts:40-43 (live xkcd summaries are `{"#text": "<img ...>", "@_type": "html"}`). Entries whose summary parses to a nested element object with none of those keys yield no thumbnail. Requires threading an optional `baseUrl` into `parseFeed(xml, baseUrl?)` → `extractFromXml`. Regex-based because parse runs in node without a DOM (HTML comments SHALL be stripped before matching).

**Why:** Additive and never regressive: thumbnails are only a hero fallback tier, and the hero only fires on failed extractions (containment). Absolutification matters — a protocol-relative or relative thumbnail would become `/img?url=//cdn...` and break the proxy fetch. RSS `description` is included for symmetry (same accepted teaser-risk class as summary). Aligns with the `improve-article-images` goal ("store thumbnail on items from feed metadata").

### D3: Hero guard matches the hero URL — and only rescues when extraction failed on images

Replace `if (doc.body.querySelector('img')) return html;` (extract.ts:68) with a three-step decision:

1. **Inline check**: if an output `<img>` matches the hero URL — exact string equality on `data-original-src`, else `decodeURIComponent(src.replace(/^\/img?url=/, ''))` (non-throwing; failure = no match) — the output SHALL NOT be modified. (Preserves the no-duplicate behavior for the common case where the hero is already inline.)
2. **Content check**: if the output contains at least one non-banner-proportioned `<img>` (see D4 for the definition), the output SHALL NOT be modified. This suppresses hero injection — and thereby duplicates and junk heroes — whenever Readability kept a real content image, even if the hero URL is a 2x/resized variant of it. This is the containment gate.
3. **Rescue**: otherwise (zero images, or only banner-proportioned images) inject the hero as the first child of `<body>`, and if the output's images were all banner-proportioned, remove them.

**Why:** The old rule defeats og:image exactly when Readability keeps junk imgs. Exact-match avoids duplicates in the common case. Step 2 is what makes the change safe for every healthy article: hero injection now happens only when extraction demonstrably produced no real image — the same failure condition the original `restore-hero-image-injection` spec targeted (zero images), extended by one junk-only case. This is a requirement change for the active `restore-hero-image-injection` change; the requirement KEEPS its original name ("Inject hero image when extracted body has no images") so the MODIFIED delta supersedes it cleanly rather than leaving a contradictory requirement behind.

**Alternatives considered:** fuzzy matching (same picture, different URL) — impossible reliably; now unnecessary since step 2 suppresses injection when content images exist.

### D4: Drop banner-proportioned images only when the output is ALL banners and a hero was injected

When a hero was injected (step 3 above), remove output `<img>` elements whose `width` attribute parses to an integer ≥ 300 AND whose `height` attribute parses to an integer ≤ 150. Images with missing or unparseable attributes SHALL be kept. Images SHALL NOT be removed when no hero was injected, and SHALL NOT be removed when the output contains a mix of banner and non-banner images.

**Why:** Combined with D3 step 2, the rule is self-limiting: it fires only when *every* remaining output image is banner-proportioned — a page whose entire "content" is 300–900×≤150 strips (xkcd's two 520×100 footer ads). A mixed article (e.g. one real chart + one banner) loses nothing, because step 2 already declined to inject. This uses the same size heuristic ad-blockers apply to leaderboard banners.

**Risk:** a legitimate article whose ONLY image is a thin banner-proportioned strip (e.g. a wide divider chart) would be dropped and replaced by the hero — an accepted trade, confined to extractions that already failed (containment).

## Risks / Trade-offs

- **Duplicate hero** (og:image URL differs from inline image URL, e.g., 2x variant) → Eliminated by D3 step 2: content images present → no injection. Spec'd.
- **Banner cleanup false positive** (legit thin image dropped) → Only when every output image is banner-proportioned AND a hero was injected (extraction already failed); ad proportions are a well-established signal. Spec'd.
- **Header hero-banner picked by the in-page tier** (no og:image, no thumbnail, big header banner with 2x srcset) → Possible but confined to already-failed extractions; the `main`/`article`-ancestor condition excludes most headers. Accepted.
- **Multi-image articles still lose inline figures** (Pokémon-class) → Deferred to content-image rescue; documented in Open Questions.
- **Stale cached `extractedHtml` for already-fetched xkcd items shows banners until re-extraction** → xkcd items have no `html`, so `bulkUpsertItems` does not null their `extractedHtml` on refresh; healing happens only via the 7-day eviction policy or a forced re-extraction, NOT on refresh. Accepted (matches the non-goal of no retroactive re-extraction).
- **`improve-article-images` change still carries the old hero rule** (any-img blocks hero, data: URI wording) → Superseded by `restore-hero-image-injection` + this delta; flagged for archival in the change summary so a future spec-sync cannot resurrect the old rule.
- **Spec drift** → D3/D4 change `hero-image-injection` requirements; spec delta + design.md updated in the same change.

## Migration Plan

1. Thread optional `baseUrl` through `parseFeed` / `extractFromXml` (existing callers unaffected; call sites scheduler.ts:136 and discover.ts:42 can pass the feed URL).
2. Implement D2 (`firstImgSrc` helper with comment-stripping, shape unwrapping) + tests in `tests/feeds.test.ts` (node-testable).
3. Implement D1/D3/D4 behind pure helpers (`heroMatch`, `isBannerImage`, `isHighSignal`) in `extract.ts`; scan the document for the in-page tier BEFORE `Readability.parse()`; update `restore-hero-image-injection` spec/design/tasks.
4. Run `npm test`, `npm run typecheck`, `npm run lint`.
5. Manual verification: `npm run dev`, add `https://xkcd.com/atom.xml`, refresh, open an item — comic renders, footer banner strips absent; open a normal text article — byte-identical rendering.
6. No data migration; stale `extractedHtml` heals organically via eviction.

## Open Questions

- Content-image rescue (rescuing every dropped inline figure for multi-image articles) — deferred; needs corpus validation of junk-aversion filters.
- Seed-text enrichment (making image-only containers scorable inside Readability) — deferred for the same reason (violates containment).
- Optional follow-up: proxying feed-HTML images via `/img?url=` in Path 1 — deliberately out of scope.
