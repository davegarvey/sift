## Context

See `proposal.md` for the motivation. The shared server fetch module already
performs HTTP(S), literal-IP, hostname-suffix, and DoH-based target checks for
the three proxy endpoints. The check is currently applied to the URL extracted
from a proxy request, while the fetch helper itself follows redirects and MCP
passes several agent-supplied URLs directly to that helper.

The browser depends on the proxy for CORS-safe feed, article, and image loading.
Many legitimate sources redirect, so a blanket redirect ban would create
avoidable discovery, refresh, article, and image failures.

## Goals / Non-Goals

**Goals:**

- Make the shared fetch boundary enforce the same target policy for every
  server-side upstream request.
- Preserve ordinary public redirects with a bounded, validated redirect loop.
- Ensure unsafe redirects fail as normal upstream errors and cannot redirect the
  browser.
- Keep feed caching, conditional requests, MCP behavior, sync storage, and
  browser parsing otherwise unchanged.

**Non-Goals:**

- Pinning a hostname to a DNS answer through the eventual socket connection.
- Adding a custom egress proxy, firewall policy, URL port allowlist, response
  size limit, or MCP authentication.
- Rejecting or rewriting feed URLs when they are stored in browser or sync
  state. Safety is enforced immediately before each server-side request.

## Decisions

### Decision 1: Enforce validation at the shared fetch boundary

Extract the current raw-URL parsing and target checks into a reusable async
validator. Keep the proxy request parser so malformed proxy input still returns
the existing `400` response, but also invoke the validator from the shared
upstream fetch helper. This prevents callers such as MCP from bypassing the
policy and lets redirect handling reuse exactly the same checks.

The validator will retain the existing public-target rules. DNS handling will
add two fail-closed cases: no terminal A/AAAA result and a malformed terminal
record. A public hostname with a usable address remains accepted, including
normal CNAME responses that also contain terminal records.

**Alternative considered:** Validate only in `handle.ts`. Rejected because MCP
and future server callers can invoke the fetch helper without passing through a
proxy route.

**Alternative considered:** Validate only at subscription or sync write time.
Rejected because stored URLs can change DNS state and content-derived URLs do
not necessarily pass through those write paths.

### Decision 2: Manually follow a small number of redirects

The fetch helper will force manual redirect handling regardless of caller
options. For each supported redirect status (`301`, `302`, `303`, `307`, and
`308`), it will require a `Location`, resolve it against the current URL, run
the validator, and then request the result. The loop will allow at most five
redirects and will use one abort controller and the existing 15-second timeout
for the entire operation rather than resetting the budget per hop.

A missing location, unsupported redirect form, unsafe destination, or exhausted
hop budget will throw through the existing error path. The caller will not see
the intermediate response. A `304` response remains available to the feed
cache's existing conditional handling; other unhandled `3xx` responses will not
be returned with redirect instructions.

**Alternative considered:** Set `redirect: 'error'`. Rejected because HTTP to
HTTPS, canonical, CDN, and moved-feed redirects are common enough to cause
visible UX regressions.

**Alternative considered:** Leave `redirect: 'follow'` and inspect the final
URL. Rejected because the private destination would already have received the
request before it could be inspected.

### Decision 3: Keep the response boundary non-redirecting

Successful public redirects are consumed inside the fetch helper. The proxy
handlers will continue returning the existing final response shapes. For
non-success responses, redirect-related headers such as `Location`, `Refresh`,
and `Content-Location` will not be passed through. This prevents a rejected or
unhandled upstream response from causing the browser to make a direct request
to a private destination.

No new user-facing error format is needed. The existing proxy `400` response
continues to describe invalid initial query input, while rejected upstream
redirects use the existing generic `502` handling.

### Decision 4: Apply the helper to MCP and discovered candidates

MCP's direct feed-item and discovery requests will continue using the shared
helper, which now validates its input. URLs extracted from HTML will be treated
as untrusted candidates and will pass through the helper independently. An
unsafe candidate will behave like a failed candidate and discovery can try the
remaining links.

No server-side feed parser or new cache is introduced. This keeps the existing
MCP result shape and browser-local parsing model intact.

### Decision 5: Test behavior at the fetch and route boundaries

Unit tests will stub the resolver and upstream fetch to verify that unsafe
redirect destinations are never requested, public redirects reach their final
response, and redirect chains are bounded. MCP tests will exercise direct
private input and private alternate-feed links. The existing literal-target,
DNS, cache, and sync suites remain unchanged except where shared fetch setup
needs to account for the new `redirect` option.

## Risks / Trade-offs

- **[Risk] A legitimate source uses more than five redirects** → Fail with the
  existing upstream error rather than allowing an unbounded chain. Five hops
  covers ordinary HTTP-to-HTTPS, canonical, and CDN redirects.
- **[Risk] Redirect validation adds DNS work** → Reuse the existing bounded
  hostname decision cache and the one overall timeout; literal IPs and blocked
  suffixes remain fast paths.
- **[Risk] DNS can change after validation** → Document that this change does
  not provide socket-level DNS pinning. Leave stronger egress enforcement for a
  separate deployment-focused change.
- **[Risk] Private or local feeds cannot use the public proxy** → Preserve the
  existing rejection behavior. Supporting local feeds would require an explicit
  trusted deployment mode and is outside this change.
- **[Risk] Existing upstream error bodies or headers change slightly** → Keep
  status and normal non-redirect behavior, removing only headers that instruct
  a client to redirect.

## Migration Plan

1. Deploy the code-only change; no database migration or persisted-data rewrite
   is required.
2. Verify public HTTP-to-HTTPS, canonical, and CDN redirects through `/feed`,
   `/article`, `/img`, and MCP discovery.
3. Verify private redirect targets and direct MCP private URLs return errors and
   produce no request to the destination.
4. Roll back by deploying the prior Worker or server build if an unusual feed
   exceeds the redirect limit. Existing feed records remain usable after either
   version is deployed.
