## 1. Sidebar structure

- [x] 1.1 Restructure `Sidebar.tsx`: remove the full-width `sidebar-add-feed` and refresh rows; add a `heading-row` wrapping the Feeds heading, an add-feed icon button (Plus), and a refresh icon button (RefreshIcon, spinning + disabled while refreshing), each with `title` + `aria-label`
- [x] 1.2 Wrap the feed list in a dedicated `feed-list` scroll container; keep the heading row and tag chips as fixed siblings in the section
- [x] 1.3 When `ctx.feeds().length === 0`, keep the add-feed icon visible, hide the refresh icon, and render no CTA in the sidebar feed list (deviations: sidebar CTA removed as a duplicate of the river empty-state CTA; refresh icon hidden until the first feed is subscribed)

## 2. Styles

- [x] 2.1 Update `styles.css`: section stops scrolling (`flex: 1` column, `overflow: hidden`), `.feed-list` gets `flex: 1; overflow-y: auto`
- [x] 2.2 Style the heading row: icon buttons matching the collapse-button pattern (28px, subtext color, hover → surface/text), heading text keeps current uppercase treatment
- [x] 2.3 Carry the refresh spinner accent override (`.sidebar-action .refresh-icon-spinning`) over to the heading-row refresh button
- [x] 2.4 Style the river empty-state "Add your first feed" CTA as a quiet button (surface background, muted accent border, accent text, hover to accent tint), with hover and focus-visible states
- [x] 2.5 Touch sizing: bump heading-row icon buttons to touch-friendly targets on `(any-pointer: coarse)`, mirroring the existing tag-chip treatment

## 3. Verification

- [x] 3.1 Verify with feeds present: heading icons visible, tag chips fixed while feed list scrolls, refresh spinner + disabled state work
- [x] 3.2 Verify with zero feeds: heading shows add-feed icon only, no refresh icon, river empty-state CTA shown, clicking either opens the add-feed modal
- [x] 3.3 Verify with a tag filter matching no feeds: both icons remain, no empty-state CTA in the sidebar
- [x] 3.4 Verify collapsed rail unchanged, mobile drawer layout intact, keyboard focus on all new buttons
- [x] 3.5 Run `npm run typecheck`, `npm run lint`, and `npm test`
