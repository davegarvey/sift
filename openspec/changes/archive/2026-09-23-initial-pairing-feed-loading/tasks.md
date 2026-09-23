## 1. Pairing refresh

- [x] 1.1 Start an explicit refresh for the post-merge feed list after successful pairing, and route pairing links through the same flow. Verify both code/key pairing and pairing-link setup reach this refresh path.

## 2. Loading feedback

- [x] 2.1 Show “Fetching your feeds…” while the visible river scope has active feed requests, retaining “Loading…” during boot hydration. Verify the message is driven by the existing per-feed fetch state.

## 3. Specification sync

- [x] 3.1 Add the pairing refresh and river loading requirements, validate the change, and archive it so the requirements are synced to the main specs.
