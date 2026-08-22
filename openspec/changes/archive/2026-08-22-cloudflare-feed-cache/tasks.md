## 1. Cache Store

- [x] 1.1 Define a portable feed representation store boundary that supports lookup, write, and runtime-local fallback without exposing Worker-only types to Node/Bun code.
- [x] 1.2 Implement Worker Cache API lookup and write using a GET key derived from the complete validated upstream URL, with internal 15-minute TTL and fetched-at metadata.
- [x] 1.3 Preserve the existing memory cache as the Node/Bun path, Worker fallback, and in-flight/retry coordination store.

## 2. Feed Integration

- [x] 2.1 Route successful feed representation reads and writes through the selected store while keeping browser validators and external `no-store` headers unchanged.
- [x] 2.2 Restore ETag, Last-Modified, representation age, and cache outcome metadata from Worker cache entries.
- [x] 2.3 Handle Cache API absence, read misses, expiry, malformed metadata, and write failures as safe cache misses or fallback writes rather than feed errors.

## 3. Verification

- [x] 3.1 Add unit tests for a fake Cache API store covering full URL/query isolation and validator-independent representation lookup.
- [x] 3.2 Add tests for internal TTL metadata, age restoration, Cache API hits after memory loss, and external `no-store` responses.
- [x] 3.3 Add tests for Cache API read/write failures and runtime fallback behavior without changing existing Node/Bun cache tests.
- [x] 3.4 Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.

## 4. Documentation

- [x] 4.1 Update README deployment/privacy text with Worker Cache API behavior, data-center-local scope, Free-plan request-limit implications, and the continued absence of sync/item storage.
