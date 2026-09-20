## Context

See proposal.md for motivation and specs for user-visible behavior. Today, `Shell` mounts the feed `Sidebar` and `River` only when `view !== 'reading'`; the reading state replaces them, and desktop CSS also hides both. `openItem` changes the app to reading state, while `setRiverScope` returns it to the river. The current river content is capped at 720px, and the feed sidebar has a separately persisted, resizable width.

The desktop workspace therefore needs to render these existing components as adjacent panes rather than putting the article list inside the feed navigation or redesigning the navigation. The mobile flow remains exclusive and sequential.

## Goals / Non-Goals

**Goals:**

- Keep the existing feed navigation, article list, and reader as distinct desktop panes.
- Let users adjust and retain article-list width without allowing it to crowd out the reader.
- Make focus mode reversible from the reader toolbar and preserve the user's desktop choice.
- Preserve mobile navigation, reader actions, and the existing sidebar design.

**Non-Goals:**

- Redesigning or reorganizing the feed navigation.
- Adding a separate close-article control or desktop Back CTA.
- Changing feed data, article ordering, or mobile reading gestures.
- Syncing pane widths or focus mode across devices.

## Decisions

### D1: Compose the desktop shell from three sibling panes

In the desktop workspace, keep the existing `Sidebar` and `River` mounted beside `ReadingView`. The river remains the article-list pane; it is not moved into the sidebar. Selecting a feed updates the river scope without leaving the reading workspace. Keep the currently open article visible while the list scope changes, then replace it when the user selects another article.

At intermediate widths, use the sidebar's existing collapsed presentation when the expanded sidebar would leave too little room. If the list and reader still cannot fit, use the existing single-column reader/river flow. At 768px and below, preserve the current mobile drawer and single-column reading behavior.

**Alternative considered:** Keep the current exclusive reading view and only leave the feed sidebar visible. This helps with feed switching but still hides the article queue, so it does not address the main article-switching friction.

### D2: Treat article-list width as an independent local preference

Add a separate article-list width preference alongside the existing sidebar width. Start at 720px on a roomy desktop viewport, matching the river's current maximum; bound user resizing to 360–720px. Constrain the effective rendered width when the viewport is smaller, preserving enough room for the reader, but do not replace the saved width with a temporary viewport clamp. Follow the sidebar resizer's pointer and keyboard-accessible interaction pattern.

**Alternative considered:** Make the article list fill all remaining space. That produces inconsistent reading widths, and on ultrawide screens makes scanning the list harder than the current 720px river.

### D3: Focus mode hides panes, not the selected article

Default to the three-pane workspace on first use. Keep an icon-only toggle in the sticky reader toolbar in both desktop states. Its tooltip text is exactly “Enable focus mode” or “Disable focus mode”. Enabling focus mode hides the feed navigation and article list, expands the reader, and retains the selected article; disabling it restores the panes without changing their widths. Store this preference locally and keep it until explicitly toggled off. Do not expose the toggle on mobile, where article-only reading is already the normal flow.

The desktop Back CTA is unnecessary in both pane and focus modes: the article list is available in pane mode, and the focus toggle restores it in focus mode. Keep the Back CTA in the mobile/single-column flow.

**Alternative considered:** Reset focus mode whenever the article changes or the app restarts. This would make the user's layout choice unpredictable during a reading session and would not honor the requested persistent toggle behavior.

### D4: Preserve URL and keyboard navigation behavior

Keep article deep links, browser `popstate` handling, and existing previous/next and J/K article navigation working when the reader is an adjacent pane. The focus toggle and resizing are layout-only state and must not create article-history entries. Feed selection changes the list scope without clearing the selected article.

## Risks / Trade-offs

- [Three panes can squeeze article text on smaller desktops] → Collapse the feed navigation first, clamp the list width to preserve reader space, and keep the current single-column flow when the viewport cannot support both content panes.
- [A saved focus preference can hide navigation on the next desktop visit] → Keep the focus toggle visible in both desktop states with explicit state-dependent tooltips; mobile ignores the preference without overwriting it.
- [A resized list can make long titles harder to scan] → Enforce a 360px lower bound and retain the current 720px maximum.
- [Sidebar selection currently exits reading state] → Update desktop feed selection to change river scope without invoking the exclusive mobile/river transition.

## Migration Plan

No data migration is required. Add optional local settings with defaults and bounds; existing installations receive the defaults when the settings are loaded. Rollback is a client release rollback; stored width/focus fields can be ignored by older code and do not affect article records.
