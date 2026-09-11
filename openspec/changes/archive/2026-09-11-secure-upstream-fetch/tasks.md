## 1. Shared Upstream Policy

- [x] 1.1 Extract the existing upstream URL and target checks into a reusable validator, invoke it from both proxy URL parsing and the shared upstream fetch boundary, and verify existing proxy-target tests still pass
- [x] 1.2 Make hostname resolution fail closed for empty or malformed terminal A/AAAA results while preserving valid CNAME-plus-terminal-address behavior, and verify dedicated DNS edge-case tests

## 2. Safe Redirect Handling

- [x] 2.1 Replace implicit redirect following with a bounded manual redirect loop that validates each `Location`, allows at most five hops, and shares the existing 15-second timeout across the operation; verify public HTTP-to-HTTPS and relative redirects succeed
- [x] 2.2 Reject unsafe, malformed, missing, unsupported, and excessive redirects before requesting their destinations, and verify loopback/private redirect tests assert no destination request occurred
- [x] 2.3 Prevent `/feed` and the other proxy endpoints from returning upstream redirect instructions, and verify rejected redirects produce the existing generic failure without `Location` or equivalent redirect headers

## 3. MCP Coverage

- [x] 3.1 Exercise direct MCP discovery and item-fetch arguments through the shared policy, and verify private inputs fail without an upstream request
- [x] 3.2 Exercise alternate-feed URLs extracted from HTML as untrusted candidates, and verify unsafe candidates are skipped or fail without being requested

## 4. Documentation and Verification

- [x] 4.1 Update the README privacy/proxy description to document validated public redirects and rejected private targets, and verify the wording matches the finalized spec
- [x] 4.2 Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` with zero failures
- [x] 4.3 Run `openspec validate "secure-upstream-fetch" --type change --strict` and resolve any artifact or implementation divergence
