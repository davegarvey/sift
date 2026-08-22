## Why

This is a greenfield RSS reader. There is no application yet — only the OpenSpec scaffolding exists in the repo. This change establishes the entire v0 of the product in a single, coherent shot so that it can be iterated on afterwards.

The reader is opinionated about one architectural bet: **all logic, state, and IO run in the browser.** The server is a stateless pipe that proxies network requests the browser cannot make directly (CORS), and serves the static app shell. It must run unchanged in three deploy contexts: local dev, container, and Cloudflare Workers. Storage is local-only (IndexedDB), with first-class export/import so the user's data is portable and never hostage to the app.

## What Changes

This is a new application, not a modification. Everything below is being introduced.

### Architecture & deployment
- A single static app shell served by an HTTP server with **exactly three** request-scoped proxy endpoints: `GET /feed?url=` (proxied feed fetch), `GET /article?url=` (proxied article HTML fetch), and `GET /img?url=` (proxied image fetch, used during article extraction to inline images as `data:` URIs). No server state, no parsing, no DB, no long-lived connections, no WebSocket/SSE.
- The server is deployable without code change to: local dev (Vite dev server or simple node/bun), a container, and Cloudflare Workers (production).
- License: **MIT**.

### Browser-side responsibilities
- Application shell, navigation, all rendering, all state.
- IndexedDB persistence of subscriptions, items, read/starred state, refresh metadata (etag, lastModified, lastFetched, learned cadence).
- Feed refresh scheduler: refreshes stale feeds on app open and periodically while the tab is open. Uses `ETag` / `If-Modified-Since` conditional requests forwarded transparently by the proxy. No background sync when the tab is closed — on next open, stale feeds refresh.
- Feed auto-discovery from a pasted URL: follow redirects, parse HTML for `<link rel="alternate" type="application/rss+xml">`, fall back to treating the URL itself as a feed.
- Feed parsing supporting RSS 2.0, Atom 1.0, and RDF (RSS 1.0) in the browser.
- Full-text article extraction using `@mozilla/readability` against proxied article HTML — so summary-only feeds still render as full articles in the reading view.
- During extraction, images are fetched via `GET /img?url=` and inlined as `data:` URIs in the cached `extractedHtml`. This solves mixed-content and hotlink protection definitively, makes extracted articles fully offline-readable, and bounds IndexedDB growth via a storage eviction policy (full HTML for 7 days, text-only after 30 days, eviction under storage pressure).
- PWA: installable, offline app shell via service worker; offline data is whatever is already in IndexedDB.

### Data portability
- **OPML** is the import/export format for the subscription list (feeds + folder structure).
- Import behavior is **merge, not replace**. Identity is feed URL. Existing feeds are skipped (read state preserved), new feeds are added, folders are merged additively. Import is never destructive.
- Export produces a valid OPML file for the subscription list. v0 does not export read/starred history (OPML doesn't carry it; a JSON sidecar for full state is a future concern, not v0).

### User experience
- **Default view** is a reverse-chronological river of all unread items — not folders-first. Folders/sidebar are on demand (`Cmd+\` desktop, drawer on mobile, hidden by default on mobile).
- **Reading IS marking as read.** No "mark as read" buttons. Opening an item marks it read. Scrolling past an item in the list marks it read after a configured delay.
- **Reading view** is a full-focus replacement of the list (not a pane beside it): serif body type, comfortable measure (~65ch), no sidebar, no chrome. Star/Original-link are the only contextual actions.
- **Keyboard-first on desktop**: j/k navigate, o open original, s star, r refresh, / focus search, `?` show shortcuts overlay. No on-screen buttons for these.
- **Gesture-first on touch**: swipe right = mark read, swipe left = star, pull-to-refresh triggers feed fetches, edge-swipe opens sidebar drawer.
- **No bulk actions** in v0. No "mark all read" button, no multi-select. Reading through the river is the only marking mechanism.
- **Restrained chrome.** No card borders, no heavy shadows, no gradients. Items separated by whitespace and a single hairline rule. Single accent color reserved for unread state and active selection; everything else is grayscale + light/dark surfaces.
- **Two themes only**: light and dark, following system preference. No accent picker, no per-feed colors.
- **Typography**: sans-serif (Inter or system) for UI chrome; serif (Charter/Georgia/system serif) for article body in reading view.
- **Empty state** ("You're all caught up.") with a subtle "Check for new items" link. Not a graphic, never hidden.
- **Add feed** is one input that accepts any URL and auto-discovers the feed. The user never needs to know what RSS is.
- **Search** is a `⌘K` palette, not a persistent search box. Progressive disclosure.
- **Responsive**: works on desktop and mobile. Sidebar collapses to a drawer under a breakpoint; reading view is full-screen on mobile; list items compress gracefully.

### Privacy
- The proxy endpoints **must not log upstream URLs** and pass through with minimal headers. Statelessness is a design property, not just a convenience.

## Capabilities

### New Capabilities
- `reader-ui`: The application shell, layout system, navigation model, reading view, **Catppuccin-based theming (Latte/Mocha)**, responsive behavior, keyboard/gesture interaction model, the **three-command `⌘K` palette (search, add feed, refresh all)**, and the UX principles (progressive disclosure, restrained chrome) that govern the interface.
- `feed-management`: Subscribing to feeds (with auto-discovery), parsing RSS/Atom/RDF, refresh scheduling (on-open, periodic-while-open, conditional via ETag/Last-Modified), and the contract for the two stateless proxy endpoints.
- `article-reader`: Full-text article extraction and rendering — Readability against proxied HTML, reading view semantics, image handling (no-referrer, mixed-content limitation).
- `data-portability`: OPML import (merge, never destructive) and OPML export for the subscription list. Local-only storage semantics.
- `deployment-targets`: The contract that the server is a stateless pipe runnable identically on local dev, container, and Cloudflare Workers.

## Impact

**Code**: New project from scratch. Establishes the entire repository structure, build setup, server entry, worker entry, and browser app.

**External dependencies** (subject to change during design): SolidJS, Vite, TypeScript, `idb` (IndexedDB wrapper), `@extractus/feed-extractor` or equivalent browser-compatible feed parser, `@mozilla/readability` for article extraction, `vite-plugin-pwa` for offline shell.

**Systems**: Cloudflare Workers free tier is the production target. No database, no key-value store, no persistent server-side storage.

**Surface area**: Browser-only IndexedDB on the user's device. No data leaves the browser except proxied feed/article fetches (which do not retain URLs server-side).

**Scope explicitly out for v0**: multi-device sync, push notifications, full-state JSON export/import (only OPML for subscriptions), search across historical items (only currently-stored), bulk actions, per-feed customization (colors, sort overrides), service-worker background sync.