## 1. Forward navigation handling

- [x] 1.1 Add `parseItemIdFromUrl` and `hashId` imports from `./routing` to `src/App.tsx`
- [x] 1.2 Expand `onPop` in `src/App.tsx` to handle forward: when view is `'river'` and URL matches `/i/<hash>`, find the item and call `ctx.openItem(item, true)`
- [x] 1.3 Verify lint and typecheck pass
