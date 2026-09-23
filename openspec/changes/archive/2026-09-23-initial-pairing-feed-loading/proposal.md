## Why

A first-time sync restores subscriptions, but articles remain local to each device. The background scheduler can defer the first fetch, leaving a newly paired device on an empty river for several minutes without a clear indication that setup is continuing.

## What Changes

- Start refreshing active feeds immediately after a successful first-time pairing.
- Show “Fetching your feeds…” in the empty river while visible feeds are being fetched.
- Use one pairing setup path for manual code/key pairing and pairing links.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `device-sync`: A new device immediately refreshes the subscriptions restored by its first-time sync.
- `reader-ui`: The empty river identifies active feed fetching with a specific loading message.

## Impact

- `src/state.tsx` starts feed refresh after a successful pairing merge and shares that behavior with pairing links.
- `src/components/River.tsx` distinguishes feed fetching from boot hydration in its loading message.
- No API, storage schema, or dependency changes.
