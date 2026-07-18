## 1. River — Single-pass instant scroll

- [x] 1.1 Modify `createEffect` in River.tsx to scroll and set state in one pass when `returnToItemId` is set, using `behavior: 'instant'`

## 2. State — View switch before reload

- [x] 2.1 Restructure `closeReading` in state.tsx to switch view to river before awaiting `reloadItems`

## 3. Verify

- [x] 3.1 Run typecheck and lint to ensure no regressions
