/**
 * Log-suppression no-op helpers.
 *
 * These functions are intentional no-ops. They exist to make a "do not log
 * this value" intent visible in code review and to give the eslint `no-console`
 * override in this directory a co-located target. They MUST remain no-ops.
 *
 * If a future change needs to log, it MUST NOT pass sync keys, feed URLs,
 * item IDs, or any other user-identifying data through these functions.
 *
 * Locations that handle sensitive data and MUST call these helpers before
 * any logging:
 *  - server/sync/auth.ts (the X-Sync-Key header)
 *  - server/sync/routes.ts (request bodies and row data)
 *  - server/sync/cron.ts (row data being deleted)
 */

export function assertNoUrlLog(_url: string): void {
  // Intentionally empty. See file header.
}

export function assertNoKeyLog(_key: string): void {
  // Intentionally empty. See file header.
}

export function assertNoUserDataLog(_label: string, _value: unknown): void {
  // Intentionally empty. See file header.
}
