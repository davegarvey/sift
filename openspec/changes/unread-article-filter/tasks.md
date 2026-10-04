## 1. State and queries

- [x] 1.1 Add a device-local remembered read-mode setting, default All, without reviving deprecated preferences implicitly.
- [x] 1.2 Resolve effective mode with existing feed/tag scope and starred bypass; query eligible articles before the 500-item limit in newest-first order.
- [x] 1.3 Use one ordered eligible list for rendering, focus and keyboard/reader navigation.

## 2. Reading behaviour

- [x] 2.1 Retain the opened article and its list position across read marking and reloads; release it on navigation or return.
- [x] 2.2 Restore focus to the next remaining neighbour, then the previous neighbour, or clear focus when empty.
- [x] 2.3 Implement caught-up feedback and Show all articles while preserving loading, fresh-install, starred-empty and failure states.

## 3. Layout

- [x] 3.1 Add the standalone right-aligned desktop control above the list, including the middle column in reading mode, without scope text or a toolbar divider.
- [x] 3.2 Place the mobile control in the existing top header and hide it while Starred is active.
- [x] 3.3 Verify keyboard access, selection semantics, touch targets and narrow layouts.
- [x] 3.4 Update README to describe the filter and its device-local preference.

## 4. Verification

- [x] 4.1 Test preference defaults/restoration, feed/tag composition, starred bypass and older unread results beyond 500 read articles.
- [x] 4.2 Test retained-row reloads, forward/backward navigation, neighbour focus and reading the last unread article.
- [x] 4.3 Test caught-up versus empty/loading/failure feedback and desktop/mobile placement.
- [x] 4.4 Run npm test, npm run typecheck, npm run lint and npm run build; visually verify both layouts.
- [x] 4.5 Validate the OpenSpec change with strict validation.
