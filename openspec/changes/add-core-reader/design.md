## Context

Greenfield repository. No application exists yet — only OpenSpec scaffolding. This change establishes v0 of an RSS reader in a single coherent shot, intended to be implemented end-to-end and then iterated on.

The architectural bet: the browser does everything (logic, state, scheduling, parsing, rendering, extraction). The server is a stateless pipe with two endpoints that exist purely to defeat CORS. The same server code runs on local dev, in a container, and on Cloudflare Workers without modification.

## Goals / Non-Goals

**Goals:**
- A working, installable, offline-capable RSS reader usable on desktop and mobile.
- Subscription management with one-paste auto-discovery.
- Full-text reading for summary-only feeds via Readability.
- Reverse-chrono river as the default view, with progressive-disclosure navigation.
- Local-only persistence (IndexedDB). OPML import/export for the subscription list.
- A server that deploys identically to local, container, and Cloudflare Workers.
- MIT-licensed, suitable for an open-source personal project.

**Non-Goals (v0):**
- Multi-device sync. (Export/import is the "poor man's sync.")
- Push notifications when the tab is closed.
- Service Worker background sync for feed refresh (flaky, overscoped for v0).
- Full-state JSON export/import (only OPML for subscriptions in v0).
- Bulk "mark all read" / multi-select actions.
- Per-feed customization (colors, sort overrides, custom refresh intervals).
- Server-side logging, analytics, or user accounts.
- Search across historical items beyond what is currently in IndexedDB.

## Decisions

### D1: Framework — SolidJS
- **Why**: JSX ergonomics for contributors; best-in-class list rendering performance (RSS rivers can contain hundreds-to-thousands of items); fine-grained reactivity without virtual DOM diffing means per-item updates as items are marked read are essentially free.
- **Alternatives considered**:
  - *Svelte 5 (runes)* — equally defensible; smaller bundle, gentler learning curve. Narrow loss to Solid on list-perf and React ecosystem familiarity. Reconsider if contribution friction becomes real.
  - *React* — heavier, worse list perf without virtualization, more boilerplate. Rejected.
  - *Vanilla/no framework* — rejected; "slick UI with restraint" is achievable, but state management across a reader is non-trivial and a framework pays for itself.
- **Risk**: Solid's community is smaller than React/Svelte. Mitigated by the small surface area of this app and the types of dependencies it needs.

### D2: Build — Vite + TypeScript
- **Why**: Vite is the standard in 2026; instant HMR, modern build output, first-class framework plugins. TypeScript is non-negotiable for IndexedDB schemas and feed-parsing edge cases.

### D3: Storage — IndexedDB via `idb`
- **Why**: The browser's only structured persistent store. `idb` is a ~1KB promise-based wrapper over the cursed callback API; thin enough that storage isn't a black box, ergonomic enough to not dread.
- **Schema sketch** (finalized in specs):
  - `feeds` store: `{ url (key), title, htmlUrl, homeUrl, folder?, lastFetched, etag, lastModified, learnedIntervalMs }`
  - `items` store: `{ id, feedUrl, guid, title, author, publishedAt, updatedAt, link, excerpt, html, extractedHtml?, read, starred, createdAt }` — index on `[feedUrl+publishedAt]`, `[feedUrl+read]`, `[starred+publishedAt]`.
  - `meta` store: `{ key: value }` for app-level state (last refresh run, etc.).

### D4: Feed parsing — `@extractus/feed-extractor` (acknowledged best-practice library)
- **Why**: Mature, browser-compatible, handles RSS 2.0 / Atom 1.0 / RDF. Avoids hand-rolling the long tail of malformed feeds in v0. Acknowledged as the standard browser-friendly feed parser; chosen over hand-rolling on `DOMParser` to dodge edge-case tar pits.
- **Fallback (only if needed at build time)**: if `@extractus/feed-extractor` pulls Node-only deps that break the browser bundle, fall back to hand-rolled `DOMParser`-based parsing for the 90% case (RSS 2.0 + Atom 1.0) and document the gap. This is a contingency, not the primary plan.

### D5: Article extraction — `@mozilla/readability` + D5b image handling
- **Why**: The standard. Mature, battle-tested, runs entirely client-side. Pairs with the `/article?url=` proxy to deliver full-text from summary-only feeds.
- **How**: When the user opens an item that has only an excerpt (no full content in the feed), the app fetches `GET /article?url=<article.link>` (or the article's home link if no direct link), runs Readability on the returned HTML, caches the extracted HTML into the item record, and renders it. Extraction is lazy — only on open, not on refresh.

### D5b: Image handling in extracted articles — inline as data: URIs with storage eviction
- **Approach**: During extraction, fetch each `<img src>` via the server image-proxy (a new endpoint `GET /img?url=<encoded>` added to D6) and store the result as a `data:` URI inside the cached `extractedHtml`. This solves mixed-content (http images on https app) and hotlink protection definitively — no `referrerpolicy` dance required.
- **Storage eviction to offset the cost**: extracted item records swell significantly (base64 images add ~33% over binary). To bound IndexedDB growth, the app runs an eviction policy:
  - Items keep full `extractedHtml` (with inlined images) for the first **N days after first open** (default N = 7).
  - When storage crosses a threshold (default **50MB per feed**, configurable), OR when an item is older than the retention window, the app **strips images** from `extractedHtml` and retains only the text content. Original image URLs are preserved in the HTML so a re-open after eviction can re-fetch and re-inline lazily.
  - Items also drop `extractedHtml` (text-only) entirely once both (a) they exceed a longer retention window (default 30 days) AND (b) storage is still under pressure.
- **Why this approach**: data: URIs make extracted articles fully self-contained and offline-readable. Eviction bounds IndexedDB growth to a predictable horizon. The two-tier retention (full HTML for 7 days, text-only after, fully evicted after 30 days under pressure) preserves the feel of "infinite history" without the cost.
- **Alternative considered**: server-side image proxy referenced by URL (no inlining). Simpler storage, but breaks offline reading and re-introduces the mixed-content hazard for offline use. Rejected for v0 — inlining aligns with the offline-first PWA bet.

### D6: Server — three stateless proxy endpoints, plus static serving
- **Endpoints**:
  - `GET /feed?url=<encoded>` — fetches the upstream feed, returns the body with `Content-Type: application/xml; charset=utf-8`. Forwards `If-None-Match` / `If-Modified-Since` from the client. On 304, returns 304 to the client. Does not parse, does not transform, does not log URLs.
  - `GET /article?url=<encoded>` — fetches the upstream article HTML, returns the body with `Content-Type: text/html; charset=utf-8`. Same forwarding semantics.
  - `GET /img?url=<encoded>` — fetches the upstream image, returns the body with the upstream's `Content-Type`. Used only during article extraction to inline images as `data:` URIs (see D5b). Same stateless, no-logging semantics.
- **Static serving**: app shell at `/`, assets at `/assets/*`.
- **Privacy**: No URL logging in any environment for any of the three endpoints. Headers forwarded are minimal — only conditional-fetch headers and `User-Agent` identifying the reader.
- **Why three endpoints and not two**: feeds, articles, and images have distinct content types and distinct client expectations. Adding `/img` is what makes the inline-data-URI image strategy in D5b work without polluting article fetching with binary transforms. Each endpoint remains a pure pipe.
- **Why stateless**: This is what makes Cloudflare Workers a clean fit. Each request is independent; no DB, no KV, no bindings required. A future requirement for per-user settings server-side would force Durable Objects or KV — explicitly deferred.

### D7: Deploy targets — single server codebase, three runtimes, via Hono
- **Approach**: The server is a small HTTP handler function `handle(request): Response`. It is invoked by:
  - **Local dev**: Vite's dev server middleware (or a tiny `bun`/`node` script for the proxy when Vite's static serving suffices). The proxy must work in `vite dev` so HMR isn't compromised.
  - **Container**: A static `Dockerfile` that builds the app and runs a minimal server (`bun`-based or hono-based) that exports the same `handle` function.
  - **Cloudflare Workers**: The same `handle` function inlined as the Worker's `fetch` handler. Uses `fetch()` from the Worker runtime for outbound (allowed). Cloudflare Assets or Workers Sites serves the static bundle.
- **Framework choice**: **Hono** (committed). It has first-class adapters for Node, Bun, and Cloudflare Workers and lets the `handle(request): Response` function be reused verbatim across all three. Hono's ~14KB bundle adds negligible cost relative to the static app shell it serves.
- **Why this works**: The server is so small (two proxy routes + static serving) that all the framework does is route. Hono's adapter pattern is the thinnest possible abstraction that satisfies "code unchanged across runtimes."

### D8: Refresh scheduling — browser-driven, polite, learned
- On app open: iterate feeds, refresh any whose `lastFetched + learnedIntervalMs < now`.
- While tab open: a single scheduler ticks every `N` minutes (default `N = 5`), refreshing feeds whose interval has elapsed. `N` is configurable at the design level (constant, not user-facing in v0).
- **`learnedIntervalMs` policy**: Initialize to 60 minutes. Track item-update timestamps observed across refreshes; if a feed publishes >10 items/day, halve the interval down to a floor of 30 minutes. If <2 items/day observed for >5 days, double up to a ceiling of 24 hours. Floor/ceiling prevent pathological cases.
- **Conditional requests**: Always forward `If-None-Match: <etag>` and `If-Modified-Since: <lastModified>` when present. On 304, update `lastFetched` but do not re-parse.
- **Why browser-only**: tab-closed = no refresh is honest and predictable. The next-open catch-up means the user sees the last-known state instantly and the fresh state streams in.
- **No background sync**: Service Worker `sync` events are unreliable (cancelled, gated by browser, not supported equally on iOS Safari). Not worth the complexity for v0.

### D9: OPML — merge-only, identity by URL
- Import flow:
  1. Parse OPML (xml: `<opml>` → `<body>` → nested `<outline>` with `xmlUrl`/`title`/`@text`).
  2. Collect every outline with an `xmlUrl`, preserving folder path (parent `<outline>` with no `xmlUrl`).
  3. Diff against `feeds` store by normalized URL (strip query string for matching only; store the original).
  4. Show preview: `N new / M skipped / 0 conflicts` and a confirm button.
  5. On confirm: insert new feeds into `feeds` store with `folder` set from OPML hierarchy. Existing feeds' `folder` field is **not** overwritten (preserves user's existing org). Read state is untouched.
- Export flow: emit OPML 2.0 with `<head><title>rss export</title></head>`, `<body>` containing nested `<outline>` mirroring folder structure, leaves with `xmlUrl`, `htmlUrl`, `text/title`.
- **Why OPML**: universal interoperability for feed lists. It's an ugly format but the only one anyone exchanges. Anything beyond subscription lists (read state, stars) has no standard and is deferred to a future JSON-sidecar approach.
- **Why merge, not replace**: destructive imports are the number-one way to lose user trust in a reader. Skip-existing is the only safe default for a single-user local app where there is no undo.

### D10: UI architecture — views, not panes
- The app has three logical "views" that replace each other (not stack side-by-side as panes):
  - **River**: list of items (default = all unread, reverse-chrono). A selected feed filter narrows it. Sidebar is overlay/toggle, not a pane.
  - **Reading**: full-screen replacement of River for the open item. Back-button returns to River at the scroll position. Sidebar is hidden.
  - **Settings / subscriptions management**: drawer/modal, never co-resident with River.
- Desktop layout: sidebar visible by default, collapsible. River occupies the remaining width. Reading replaces River. Items are nav-able with j/k; opening switches to Reading.
- Mobile layout: sidebar is a drawer (`≡` hamburger or edge-swipe). River fills the screen. Tapping an item switches full-screen to Reading. Back-gesture returns to River.
- **Why views-not-panes**: a four-pane reader is the "developer put buttons everywhere" failure mode we want to avoid. The traditional three-pane desktop reader is a museum piece from 2005. Modern readers (Reeder, Feedbin mobile, Matter) have moved past it. We follow that curve.

### D11: Theming — two themes, system-follow, Catppuccin-pinned
- Light and dark. No third theme, no per-feed theming, no accent picker. Theme palette follows **Catppuccin** (Latte for light, Mocha for dark) — the muted, pastel color scheme already familiar across many developer tools.
- Surface and text colors use Catppuccin's defined base/text/subtle values per variant. The single accent color is **Catppuccin Mauve** (`#8839ef` in Mocha, `#8839ef`-flavor in Latte Catppuccin's mauve `#7287fd`) reserved exclusively for: unread dot indicator and active selection background. All other surfaces use the variant's `base`, `mantle`, `surface`, `text`, `subtext`, and `overlay` color values — not raw grayscale.
- Theme follows `prefers-color-scheme` at app boot; user can override in settings (not a v0 requirement, but the CSS variables make it trivial). Default = follow system.
- **Why this stance**: theming scope creep is real. Pinning Catppuccin removes the accent-color decision entirely and gives a tested, accessible palette. Restraint is the aesthetic.

### D12: Typography — sans for chrome, serif for body
- UI chrome (nav, list items, sidebar): a system stack leaning into Inter when available. Sizes on a constrained scale.
- Reading view body: `Charter, "Iowan Old Style", Georgia, serif` — system-first; no web fonts required. Headings inside articles follow the same serif stack.
- Article body measure: `max-width: ~65ch`. Line-height `1.6`-ish. The single biggest "this feels professional" lever for a reader.

### D13: PWA — installability + offline app shell, not offline data layer
- Use `vite-plugin-pwa` to generate a service worker that precaches the app shell (HTML/JS/CSS) for offline load. IndexedDB already provides offline data; the SW just makes the shell load when offline.
- Web manifest with name "rss", a simple SVG/icon, and "display": "standalone".
- **No**: Workbox recipes for runtime caching of upstream feed/article content — that would duplicate the proxy logic and add complexity.
- **No**: Service Worker background sync for feed refresh (per D8).

### D14: Keyboard, gestures, no button chrome
- Keyboard map (desktop):
  - `j` / `k` — next/prev item (and at the end of river, loads more)
  - `Enter` / `o` — open original in new tab
  - `s` — toggle star on current item
  - `r` — manual refresh of all feeds (or current filter)
  - `?` — show shortcuts overlay (auto-dismiss on next key)
  - `/` — open `⌘K` search palette
  - `Esc` — back to River from Reading
  - `Cmd+\` — toggle sidebar
- Touch gestures (mobile):
  - swipe-right on list item → mark read
  - swipe-left on list item → star
  - pull-down at top → refresh (pull-to-refresh pattern)
  - edge-swipe from left → open sidebar drawer
  - tap item → open Reading; back-gesture/hardware back → return
- No visible buttons for any of these. The only visible buttons in the chrome are: a top-right refresh button (shown when stale feeds are detected), the settings gear, and the `⌘K` affordance. The empty state has a "Check for new items" link.

### D15: "Mark read" semantics — implicit, two-way
- **Reading view**: opening an item sets `read = true` immediately on item open (not on scroll completion). Rationale: a user who opens an item has seen the title at minimum; lying to them about read state is worse than the alternative.
- **River list**: scrolling an item fully out of the viewport marks it `read = true` after a small delay (default 500ms). The intent is "I scrolled past this and didn't tap it; treat as read." This is non-default behavior and worth surfacing in onboarding text — but it's a defining UX choice and we commit to it.
- **Manual override**: clicking the unread dot indicator on a list item toggles read/unread. Visible only on hover/focus so the chrome stays clean.

## Risks / Trade-offs

### [R1] CORS still blocks some assets, breaks some feeds
- Some RSS providers return feeds with strict CORS even on the proxy path — except no, the proxy fetches server-side so those headers don't apply to the browser. Actual risk reduces to mixed-content (http images on https app) and hotlink-protected images.
- **Mitigation**: `referrerpolicy="no-referrer"` on article images solves the latter. Mixed-content is a documented v0 limitation; a future `/img?url=` proxy endpoint would solve it cleanly.
- [Acceptance] Document the limitation in README. v0 lives with it.

### [R2] Cloudflare Workers free-tier rate limits
- Free tier allows 100k requests/day. For a single user refreshing ~50 feeds hourly with conditional requests, that's ~50 × 24 = 1,200/day — nowhere near the cap. Extraction adds another ~10/hr.
- **Mitigation**: none needed for v0. Document the assumed usage profile in deployment docs. If a single user somehow hits the cap, something is deeply wrong with the scheduler.

### [R3] Readability extraction fails on paywalled / bot-protected sites
- Some article pages return 401/403 or bot-challenge HTML to the proxy. Extraction will produce garbage or empty content.
- **Mitigation**: in Reading view, if extracted HTML is empty, hide it and show a notice "Couldn't extract this article" with a prominent "Open original ↗" link. This is graceful degradation — better than a blank page.
- **Acceptance**: The reading experience is "if full-text is unavailable, you still have the excerpt and the link." Not all sites will work; that's the nature of the web in 2026.

### [R4] Safari has uneven IndexedDB + Service Worker behavior
- Safari's IndexedDB quotas and SW eviction are aggressive. In low-storage conditions, IndexedDB can be cleared without warning.
- **Mitigation**: Surface storage usage in Settings. For v0 (single-user, local), accept that users on iOS who clear browser data will lose their state — this is the explicit cost of "no server-side state."
- **Acceptance**: v0 is honest about being local-only. The OPML export mitigates the worst case (resubscribing is one click from a backup file).

### [R5] Feed parsing edge cases (malformed dates, missing guids, non-UTF8)
- Real feeds are a nightmare of malformed XML, RFC-822 vs ISO-8601 dates, missing GUIDs (which break dedup), and the occasional CP-1252 encoded file.
- **Mitigation**: Choose `@extractus/feed-extractor` precisely because it handles the long tail. Fall back to using `link + pubDate` as a synthetic GUID when `guid` is absent. Document that some feeds will simply not parse.
- **Acceptance**: A "couldn't parse this feed" subscription error message is acceptable; we surface it in the Add Feed flow so the user can decide whether to retry or give up.

### [R6] "Implicit mark-read on scroll" can surprise users
- The default scroll-means-read behavior is opinionated and not what every reader app does. Some users will be annoyed that items disappeared from their list without explicit action.
- **Mitigation**: Add a Settings toggle "Mark items read when I scroll past them" (default ON). The empty state's "Check for new items" affordance frames the model positively ("you're caught up") rather than negatively ("you lost items").

### [R7] No undo
- v0 has no Undo. Star/unstar is a toggle, but `read` is one-way per session unless manually overridden per item. There is no "mark unread" reminder for an entire feed, no restore for an accidentally-imported-then-deleted subscription.
- **Mitigation**: OPML export before destructive operations is out of scope for v0 (it's the user's responsibility to back up). Document this. Future: trash folder for deleted feeds, undo toast for star/unstar.

### [R8] Auto-discovery misses feedless sites, false-positives
- A pasted URL might point to a homepage with no feed, or to an article page where the only `<link rel="alternate">` is a comment RSS feed unrelated to the main site.
- **Mitigation**: After discovery, show the discovered feed's *title and recent item count* in the Add Feed modal before "Subscribe" is committed. User confirms. If discovery fails, an explicit error with retry/give-up paths.

## Migration Plan

Not applicable — greenfield. No existing users, no existing data. Deploy by:
1. Tag v0.0.0 on the main branch.
2. Build artifacts via `vite build` → `dist/`.
3. Deploy `dist/` + server entry to Cloudflare Workers via `wrangler deploy`.
4. Local users can `npm run dev` for development; `npm run build && npm start` for local prod-mode; or `docker build . && docker run` for containerized.

Rollback = redeploy previous Worker version; there is nothing else to roll back.

## Open Questions

All open questions have been resolved and folded into the design decisions above:

- **OQ1 (resolved → D11)**: Accent color is Catppuccin Mauve. Full palette is Catppuccin Latte (light) / Mocha (dark).
- **OQ2 (resolved → D7)**: Hono is committed as the server framework.
- **OQ3 (resolved → D4)**: `@extractus/feed-extractor` is the primary choice, with a documented fallback to hand-rolled `DOMParser` parsing only if bundling breaks.
- **OQ4 (resolved → D5b + D6)**: Images are inlined as `data:` URIs in extracted HTML, with storage eviction (7-day full, 30-day text-only, evict under pressure) to bound IndexedDB growth. A new `/img?url=` server endpoint supports this.
- **OQ5 (resolved → reader-ui spec)**: The `⌘K` palette will host three commands in v0: Search items, Add feed, Refresh all. No other quick actions.

No open questions remain.