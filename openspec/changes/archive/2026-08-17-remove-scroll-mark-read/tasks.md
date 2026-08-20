## 1. Remove IntersectionObserver logic from River.tsx

- [x] 1.1 Delete the `IntersectionObserver` setup, `leaveTimers` map, `hasBeenSeen` set, and related state variables
- [x] 1.2 Delete the `onCleanup` handler that disconnects the observer and clears timers
- [x] 1.3 Delete the `refreshObserver` polling interval and the second `onMount` that starts it
- [x] 1.4 Update the remaining `onMount` to only call `onFocusChange`
- [x] 1.5 Remove `onCleanup` from the SolidJS import

## 2. Remove markReadOnScrollPast from schema and state

- [x] 2.1 Remove `markReadOnScrollPast` from the `AppSettings` interface in `db/types.ts`
- [x] 2.2 Remove `markReadOnScrollPast` from `DEFAULT_SETTINGS` in `db/types.ts`
- [x] 2.3 Remove `markReadOnScrollPast` from the initial settings signal in `state.tsx`

## 3. Remove Settings UI toggle

- [x] 3.1 Remove the `setMarkRead` function from `SettingsDrawer.tsx`
- [x] 3.2 Remove the Behavior group (toggle button, label, aria attributes) from the Settings JSX

## 4. Verify

- [x] 4.1 `npm run typecheck` passes with zero errors
- [x] 4.2 `npm run lint` passes with zero errors
