## Why

Read articles remain interspersed with unread articles, making repeat visits require extra scanning. A remembered Unread / All control lets readers choose what remains to read while preserving access to their complete stored list.

## What Changes

- Add a standalone Unread / All segmented control, with All as the initial default and a device-local remembered choice.
- Float the control above the desktop article list without a scope heading or toolbar divider; keep it above the middle column when reading.
- Place the control in the mobile top header beside the wordmark, without a separate row above the articles.
- Apply the filter to the existing feed/tag selection. Starred temporarily bypasses it and hides the control, retaining the remembered choice.
- Keep the currently opened article in place until the reader moves on or returns to the list, then remove it if it is read in Unread mode.
- Keep keyboard navigation and focus aligned with the visible list.
- Query matching unread articles before applying the 500-item limit.
- Distinguish caught-up, loading, empty and failed states; offer Show all articles when caught up.

## Capabilities

### New Capabilities

- `unread-article-filter`: selection, placement, persistence, queries and stable reading transitions.

### Modified Capabilities

- `river-focus-restore`: restore focus to a remaining neighbour when the article just read is excluded.
- `starred-filter`: the shared scoped query applies starred eligibility before limiting results instead of requiring `listStarred()`.
- `reader-ui`: update the empty-state contract for the scoped unread list.

## Impact

Client state, settings, IndexedDB item queries, River, TopBar and reader navigation require changes. Existing starred feed/tag composition remains intact. README and focused tests need updating. No server changes or new dependencies are planned.

## Non-goals

Unread counts, bulk marking, multi-select, sync of the filter preference and changes to when opening an article marks it read.
