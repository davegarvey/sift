## Why

The sync pairing QR code displays the hint "Open Sift on your other device and scan", but Sift has no QR scanning capability. Users must manually copy an 8-character pairing code. Adding in-app QR scanning makes pairing seamless — point the camera at the QR code and pairing completes automatically.

## What Changes

- Add QR scanner overlay with camera viewfinder, corner-bracket targeting frame, and jsqr-based decoding
- Add "Scan QR" text button in the "Join existing sync" section of sync settings
- Auto-refresh the pairing code when it expires (replacing the manual Regenerate button)
- Add visual SVG countdown ring to the pairing code display (replacing the "valid for X min" text)
- Fix shared `busy` signal bug that incorrectly changes the Pair button text when generating a code
- Add `jsqr` dependency

## Capabilities

### New Capabilities
- `qr-scanner`: In-app QR code scanning for sync pairing — detects QR codes via device camera, decodes the pairing URL, and completes the pairing flow automatically

### Modified Capabilities

None. No existing specs are changing.

## Impact

- **New dependency**: `jsqr` (~60KB, dynamically imported)
- **Modified**: `src/components/SettingsDrawer.tsx` — new Scan QR button, scanner overlay rendering, auto-refresh and countdown ring, busy signal split
- **New file**: `src/components/QrScannerOverlay.tsx` — camera viewfinder, frame capture, QR decode loop
- **Modified**: `src/styles.css` — scanner overlay styles, countdown ring styles
- **No server changes**: pairing protocol unchanged
