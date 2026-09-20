## 1. Desktop Reading Workspace

- [x] 1.1 Render the existing feed navigation, river article list, and reader as separate desktop panes while preserving the mobile single-column flow; verify with layout tests at desktop and mobile widths.
- [x] 1.2 Keep the existing feed-navigation layout and make feed selection update the article-list scope without leaving desktop reading; verify the selected article remains visible and the list changes scope.
- [x] 1.3 Make article-list selection replace the reader content in place while preserving article URL, browser history, and J/K navigation behavior; verify with reader navigation tests.

## 2. Resizable Article List and Responsive Layout

- [x] 2.1 Add a local article-list width preference with a 720px initial/max width and a 360px minimum; verify defaults, bounds, and loading of existing settings in settings tests.
- [x] 2.2 Add an accessible pointer- and keyboard-operable article-list resizer that saves user width independently of sidebar width; verify resizing, bounds, and persistence in tests.
- [x] 2.3 Implement responsive pane sizing that constrains effective list width without overwriting the saved value, collapses the feed navigation when needed, and retains the current mobile flow at ≤768px; verify at wide, intermediate, and mobile viewport widths.

## 3. Focus Mode and Reader Chrome

- [x] 3.1 Add a local focus-mode preference defaulting to off, with an icon-only toolbar toggle and the exact state-dependent tooltips “Enable focus mode” and “Disable focus mode”; verify persistence and pane show/hide behavior in tests.
- [x] 3.2 Remove the Back CTA from desktop pane and focus layouts while keeping the focus toggle available and preserving the Back CTA in the single-column flow; verify desktop, compact, and mobile reader chrome behavior.

## 4. Verification

- [x] 4.1 Run OpenSpec validation, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; verify all complete successfully.
