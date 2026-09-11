## Why

Sift's public proxy accepts user-controlled feed, article, and image URLs. The
current validation protects the initial URL but does not protect server-side
fetches reached through redirects or MCP calls that bypass the request parser.
This leaves a straightforward path to local or private network targets while
making a broad redirect ban unnecessary for normal feed usage.

## What Changes

- Add one shared server-side upstream request policy used by `/feed`, `/article`,
  `/img`, and MCP fetch operations.
- Validate the initial target at the fetch boundary, including all existing
  HTTP(S), hostname, literal-IP, and DNS safety checks.
- Follow ordinary public HTTP redirects without changing normal feed, article,
  or image behavior; resolve and validate every redirect target before fetching
  it.
- Cap redirect hops and the total request time. Invalid, private, missing, or
  excessive redirects return the existing generic upstream failure instead of
  exposing a redirect to the browser.
- Treat DNS responses with no usable terminal A/AAAA address, or malformed
  terminal records, as unsafe.
- Add focused regression tests for redirect targets, MCP inputs, and ambiguous
  DNS results.
- Do not add custom DNS pinning, an egress service, port restrictions, response
  size limits, or new authentication in this change.

## Capabilities

### New Capabilities

- `secure-upstream-fetch`: Safe validation and redirect handling for all
  server-side requests to user- or content-supplied upstream URLs.

### Modified Capabilities

## Impact

- `server/fetch.ts` becomes the enforcement point for upstream URL validation,
  redirect handling, and shared fetch behavior.
- `server/handle.ts` continues to expose the existing proxy endpoints while
  returning only final upstream responses or the existing error responses.
- `server/mcp.ts` uses the same policy for direct tool arguments and feed links
  discovered in fetched HTML.
- Proxy and MCP tests gain redirect and DNS safety coverage.
- Valid public redirects remain supported; only unsafe or malformed upstream
  targets change behavior.
