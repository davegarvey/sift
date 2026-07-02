## 1. State Changes

- [x] 1.1 Add `returnToItemId: string | null` to `AppState` interface, init `null`
- [x] 1.2 In `openItem`, save `item.id` to `returnToItemId`
- [x] 1.3 In `closeReading`, preserve `returnToItemId` (don't clear it — River clears it after restoration)

## 2. River Restoration

- [x] 2.1 In `River.tsx`, add a `createEffect` that watches `visibleItems()` and, when `returnToItemId` is set, finds the matching item by ID, sets `focusedIndex` to its index, and clears `returnToItemId`
