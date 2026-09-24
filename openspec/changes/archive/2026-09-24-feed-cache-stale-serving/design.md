## Context

`fetchFeedCached` stores successful bodies in runtime memory and, on Workers, in the data-centre-local Cache API for a fixed 15 minutes. `revalidateFeed` bypasses the cache when the upstream sends `Set-Cookie`, `Vary: *` or a body over 2 MB. Failures record a URL cooldown (memory, Cache API and D1) and a `429`/`419` also records an origin cooldown. During a cooldown the proxy returns the failure status with `Retry-After`. The client records every non-2xx as a feed error and shows a warning in the sidebar.

A probe of production on 2026-09-24 showed the BBC feed served from cache while Guardian and Reddit feeds bypassed it on every request; the third Reddit request within two seconds returned `429`.

## Goals / Non-Goals

**Goals:**

- Upstream requests per feed are bounded by time, not by the number of clients.
- Follow the upstream's own freshness and retry instructions.
- Clients keep receiving the most recent representation while an upstream pushes back.
- The interface stays quiet for conditions that need no user action.

**Non-Goals:**

- A globally shared cache or a Durable Object per feed. The Cache API remains data-centre-local.
- Changing the origin governor or cooldown durations.
- New sidebar indicators.

## Decisions

### Ignore `Set-Cookie` and `Vary: *` when caching

These rules protect shared HTTP caches from personalised responses. The proxy sends a fixed request with no client credentials, stores only the body and validators, and never returns upstream cookies, so every client would receive the same representation anyway. The 2 MB body limit remains.

### Freshness is the longer of Sift's floor and upstream hints

Freshness = clamp(max(15 minutes, hints), 15 minutes, 24 hours). Header hints: `s-maxage`, else `max-age`, else `Expires` minus `Date`. Body hints, read from the first 64 KB: RSS `<ttl>` in minutes and `sy:updatePeriod` divided by `sy:updateFrequency`. Taking the longest signal is the conservative reading of what the publisher asked for. A 304 revalidation recomputes freshness from its headers and the stored body. The 24-hour cap bounds how long a publisher's hint can delay updates.

### Retain for 24 hours after freshness and serve stale on transient failure

Each entry records `freshUntil`. Entries are kept until `freshUntil + 24 h` in memory and in the Cache API (whose `max-age` is set to that retention). A request for a stale entry revalidates as before. If revalidation fails, or a URL/origin cooldown blocks it, with a transient status (`408`, `419`, `425`, `429`, `5xx`, network failures represented as `502`, and local-gate `429`s) the proxy returns the retained representation with the client's own conditional handling, `X-Sift-Cache: stale`, `Age` from the last upstream success and `X-Sift-Retry-After` with the seconds until the next upstream attempt. Non-transient failures such as `404` and `410` are returned as today so that genuinely broken feeds remain visible. Cooldown recording is unchanged, so serving stale never causes additional upstream requests.

`X-Sift-Retry-After` is used rather than `Retry-After` because the response is a successful `200`/`304`, for which `Retry-After` has no defined meaning.

Entries written before this change lack the fresh-until metadata and are treated as misses; they would have expired within 15 minutes anyway.

### Client: quiet transient failures, status in the editor

The client stores two local-only fields on the feed: `sourceFetchedAt` (now minus `Age`) and `nextCheckAt` (from `X-Sift-Retry-After`, cleared otherwise). Sync merges preserve them locally and never send them. A failure is shown in the sidebar unless its status is transient (network `0`, `408`, `419`, `425`, `429`, `5xx`) and the feed was received within the last 24 hours. Backoff (`refreshError`) is still recorded in all cases. The feed editor shows "Updated 40m ago", with "· next check 14:30" when `nextCheckAt` is in the future.

## Risks / Trade-offs

- **[Risk] A publisher's long `<ttl>` delays updates** → Capped at 24 hours, and it reflects the publisher's stated cadence.
- **[Risk] A feed that is permanently gone behind a `5xx` is shown stale for up to a day** → The retention window bounds it; afterwards the failure reaches the client and the warning appears.
- **[Risk] Larger Cache API footprint from 24-hour retention** → Bodies are capped at 2 MB and Cache API storage is evicted by Cloudflare under pressure; eviction only loses the stale fallback.
