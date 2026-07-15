## 1. Server-side rate limit

- [x] 1.1 Bump `registerPerIp.limit` from 10 to 100 in `server/sync/ratelimit.ts`

## 2. Client-side error handling in enableSync

- [x] 2.1 Add try/catch in `state.tsx:enableSync()` that calls `disableSync()` on failure and rethrows
- [x] 2.2 Add `syncError` signal and try/catch in `SettingsDrawer.tsx:SyncSection.toggleOn()` that logs to console and sets error message
- [x] 2.3 Render error message inline in the Settings drawer JSX below the sync toggle
