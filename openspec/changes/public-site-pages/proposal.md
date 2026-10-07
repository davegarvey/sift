## Why

Sift is now indexed by search engines and receives visitors other than its author. A first-time visitor lands in an empty reader showing only "Welcome to Sift" and "Add your first feed". Nothing explains what Sift is, that reading data stays in the browser, that no account is needed, or that Sift can be self-hosted. The hosted instance is intended as the canonical public instance, so it also needs a privacy policy and terms of use. Search engines currently index little beyond the meta description, because the app renders client-side.

## What Changes

- Expand the no-feeds empty state into a short welcome: a one- or two-sentence description, the data-location statement, and actions to add a feed, import OPML, pair a device, and try a small set of sample feeds. Link to the About page. The state appears only when there are no feeds, so existing readers never see it.
- Add a sample-feeds action that subscribes to a small curated set of public feeds so a visitor can see the reader working immediately. The feeds remain ordinary subscriptions that the reader can delete.
- Curate two stable, low-volume public feeds: Mozilla Hacks (`https://hacks.mozilla.org/feed/`) and NASA News Releases (`https://www.nasa.gov/news-release/feed/`). Both are published by their operators as RSS feeds.
- Add static, crawlable `/about`, `/privacy` and `/terms` pages, served outside the SolidJS app, each with a link back to the reader.
- Add an About entry, using the Lucide `Info` icon, to the sidebar footer beside Settings and to the collapsed desktop rail. Link Privacy and Terms from the About page and the settings drawer.
- Exclude the static pages from the service worker's `navigateFallback`, so installed clients load them rather than the app shell.
- Write the privacy policy from what the code does: local-only browser storage; proxy requests that are not logged; optional sync data held in Cloudflare D1; polling that stores complete feed URLs, including embedded credentials; retention periods; Cloudflare as processor; no analytics or tracking cookies. Give a forwarding contact address.
- Write short terms: free service provided as-is without availability guarantees; the operator may limit, change or withdraw the service and remove inactive accounts; acceptable use of the proxy; a contact for copyright requests; not directed at children under 13.

## Capabilities

### New Capabilities

- `public-site-pages`: static About, Privacy and Terms pages, their serving across adapters, and their exclusion from the service worker fallback.

### Modified Capabilities

- `reader-ui`: the no-feeds welcome state and its actions, including sample feeds.
- `sidebar-layout`: the About entry in the sidebar footer and collapsed rail.

## Impact

`src/components/River.tsx` (empty state), `src/components/Sidebar.tsx`, `src/components/SettingsDrawer.tsx`, new static HTML under `public/`, `vite.config.ts` (workbox `navigateFallbackDenylist`), and possibly `server/node.ts` and `server/bun.ts` so `/about` resolves without a `.html` suffix as it does under Workers assets. README gains links to the pages. No new dependencies.

## Dependencies

- The privacy policy should not be published until `delete-sync-data` provides a deletion route and a retention period it can cite.
- The contact address (a forwarding alias) must exist before publication.

## Open questions

- Which sample feeds to include. They should be stable, well-formed, low-volume and uncontroversial, and their publishers should not object to the extra traffic.
- Whether the welcome state should also link to the GitHub repository for self-hosting, or leave that to the About page.

The self-hosting link belongs on the About page; the welcome state links there without adding another action.

## Non-goals

A marketing landing page in front of the app, analytics, cookie banners, account sign-up, and a first-run tour for readers who already have feeds.
