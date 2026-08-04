## Why

Sift is entirely local — every browser holds its own IndexedDB with no cross-device communication. Users who read on a laptop and want to continue on a phone (or vice versa) see disconnected worlds: different subscription lists, different read state, different starred items. The "Bring your own reader everywhere" expectation of a modern RSS app is missing.

## What Changes

- Add a server-side sync layer backed by Cloudflare D1 (extends the existing Worker, no new runtime, no new infra cost).
- Sync three things, and only three things: **feed subscriptions** (URL + folder), **read flags** per item, **starred flags** per item.
- Do **not** sync: article content, thumbnails, settings (theme, MCP toggle, etc.), per-device UI state (sidebar collapsed, river scope, etc.), feed-fetching metadata (ETag, Last-Modified, learned intervals).
- **Sync key model**: 128-bit cryptographically random key, base64url-encoded (22 characters), used as a bearer token (`X-Sync-Key` header). The key *is* the user identity — no account, no email, no password.
- **Three pairing flows**, all supported equally:
  - **QR code**: source device shows a QR encoding the sync key; target scans with a camera. Works for any device with a camera. No server roundtrip needed for the key transfer.
  - **8-character server-generated OTP**: source device requests a code; server generates an 8-character code (5-minute TTL) and returns it; target types the code; server returns the sync key to the target. Works in any direction with no camera needed.
  - **Paste**: target pastes the full 22-character sync key directly. Works in any direction, no camera, no server roundtrip.
- **No device-type detection**. All three flows are always available in a unified pairing modal. Tablet support falls out for free.
- **User creation is explicit** via `POST /sync/register`. Push and pull reject unknown keys with 401 (no lazy user creation — that would be a public user-creation API and a D1 storage DoS vector).
- **In-Worker rate limiting** (D1-backed counter, no Cloudflare WAF — keeps the deploy on the free plan). Per-IP limits on `/sync/register`; per-sync-key limits on `/sync/push` and `/sync/pull`.
- **Per-user row caps** (10K feeds, 1M flags) to bound D1 usage per user. Push returns 413 above the cap.
- **PATCH push semantics with per-field timestamps**, not full-row PUT. Avoids stale-write clobbering of concurrent changes on other fields of the same row.
- **Monotonic server time** via a D1 counter table. `Date.now()` is not monotonic (NTP slew, container pauses, Cloudflare infra) and a regression would break the `since=X` pull model.
- **First-time setup ordering**: push all local → pull `since=0` → merge in memory with per-field server-newer-wins → apply to local IDB → re-push the merged state to ensure convergence.
- **Browser keeps a "dirty set" of local changes in the IDB meta store**, debounces push (1s), and pulls on app boot + tab focus + browser `online` event.
- **Sync is opt-in and per-user-data-plane**: enabling sync is a one-time setup; users without sync enabled see no UI changes. Toggling off clears the local key AND the dirty set (otherwise the next enable could push stale entries to a new key).
- New "Sync" section in the Settings drawer with toggle, pairing modal (QR + OTP + paste), key display, last-sync time, regenerate button, and a manual "Sync now" button.

## Capabilities

### New Capabilities
- `device-sync`: opt-in state sync of subscriptions and read/starred flags between devices, identified by a 128-bit bearer-token sync key, backed by a D1 database on the existing Worker, with QR / OTP / paste pairing and per-field PATCH semantics.

### Modified Capabilities

(None — no existing specs to modify. The change is purely additive.)

## Impact

- **Modified `wrangler.toml`**: add a `[[d1_databases]]` binding for the sync store; add a `[triggers]` cron entry for the tombstone GC.
- **Modified `server/handle.ts`**: register four sync routes (`/sync/capabilities`, `/sync/register`, `/sync/push`, `/sync/pull`) behind an in-Worker rate limiter; provide a `createApp()` factory parameter or environment branch that enables the sync routes only when the D1 binding is present.
- **New `server/sync.ts`**: schema bootstrap (idempotent `CREATE TABLE IF NOT EXISTS`), auth middleware, rate limiter, route handlers, all queries parameterized by `sync_key`. No PII in logs.
- **New `server/migrations/0001_sync.sql`**: D1 schema (committed alongside, applied via `wrangler d1 migrations apply`).
- **New `src/sync/`**:
  - `key.ts` — sync key generation, validation, persistence to IDB meta
  - `capabilities.ts` — detect server sync support
  - `client.ts` — fetch wrappers for register/otp/redeem/push/pull with retry and backoff
  - `queue.ts` — dirty-set bookkeeping in IDB meta
  - `apply.ts` — applies remote state into local IDB
  - `merge.ts` — first-time setup merge logic
  - `init.ts` — boot/focus/online pull hooks
- **New `src/sync/qr.ts`**: small focused QR encoder (model 2, error correction M, byte mode) using a vetted library (`qrcode-generator` ~5KB) for the 22-byte key case.
- **New `src/components/PairDeviceModal.tsx`**: unified pairing modal (QR + OTP + paste).
- **Modified `src/components/SettingsDrawer.tsx`**: new "Sync" section.
- **Modified `src/state.tsx`**: call sync hooks on relevant state mutations; boot-time pull; visibility-change pull; first-time setup merge; `online` event pull.
- **Modified `src/db/types.ts`**: add `syncKey`, `lastSyncAt` to `AppSettings`.
- **New tests**: `tests/sync-server.test.ts` (route handlers with a fake D1), `tests/sync-client.test.ts` (queue/apply/merge with `fake-indexeddb`).
- **No new infrastructure cost**: D1 is included on the Workers Free plan. Rate limiting is implemented in the Worker code, not via WAF. QR encoding uses a small library, no Cloudflare-specific dependency.
