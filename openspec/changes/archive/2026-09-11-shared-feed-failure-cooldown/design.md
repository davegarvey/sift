## Context

See `proposal.md` for the motivation. The existing `/feed` path stores
successful representations in bounded memory and, on Workers, the data-center-
local Cache API. It already coalesces revalidation within a running isolate and
suppresses repeated `429` responses locally. Browser refresh scheduling also
has its own persisted error backoff.

The new state must reduce repeated failed probes across Worker users without
moving feed content into the sync database or making D1 a dependency for
Node/Bun deployments.

## Goals / Non-Goals

**Goals:**

- Share only failure status and retry timing across Worker requests and isolates.
- Keep successful body caching and client-specific validator handling unchanged.
- Make D1 lookup and write failures non-fatal to feed fetching.
- Keep the state bounded by the existing scheduled cleanup and avoid raw URL persistence.
- Preserve a local-only path for runtimes without D1.

**Non-Goals:**

- Globally sharing successful feed bodies across Cloudflare data centers.
- Introducing a global lock or waiting room for successful cache misses.
- Storing feed XML, parsed items, article content, or user data in D1.
- Changing redirect handling or adding a feed-specific alternate source.
- Changing the browser's normal refresh cadence or error backoff policy.

## Decisions

### Decision 1: Store hashed failure metadata in a separate D1 table

Add `feed_fetch_failures` with a SHA-256 `feed_key` primary key, the recorded
HTTP status, the absolute retry timestamp, and an update timestamp. The
complete validated upstream URL is hashed before it reaches D1, so the table
cannot be used as a raw URL catalogue and does not contain feed bodies.

The migration is the production source of truth. An idempotent runtime
`CREATE TABLE IF NOT EXISTS` keeps local development and preview behavior
usable when migrations are not applied. The existing daily cron deletes rows
whose retry timestamp has passed.

**Alternative considered:** Reuse the sync `rate_limits` table. Rejected because
fixed-window counters cannot preserve the failure status and exact retry time,
and mixing global feed state with authenticated sync limits obscures retention
and semantics.

**Alternative considered:** Store the full feed representation in D1. Rejected
because it would make feed content persistent, increase D1 read/write volume,
and cross the existing browser-local/sync data boundary.

### Decision 2: Keep local and regional fast paths

On a cache miss or stale representation, check the existing local cooldown and
Worker Cache API failure marker before reading D1. A D1 failure record is only
read when those faster paths do not answer the request. A failed upstream
attempt writes the local state, the regional failure marker when available,
and the shared D1 record.

D1 failures are fail-open: if D1 cannot be read or written, the request follows
the existing local/cache behavior. This preserves feed availability at the
cost of losing cross-isolate suppression during the D1 outage.

**Alternative considered:** Read D1 on every `/feed` request. Rejected because
fresh successful cache hits already avoid upstream work and should not incur a
database round trip.

### Decision 3: Cool down only actual upstream failures

Statuses `400` through `599` enter the generic failure path. Network and timeout
exceptions are represented as `502`. Redirects and all `2xx` responses do not
create failure state. A valid `Retry-After` is parsed as seconds or an
HTTP-date, then capped at 24 hours; missing or invalid values use 30 minutes.

The first failed response preserves its upstream status, headers, and body.
Later requests during suppression receive the recorded status, no body, and a
fresh `Retry-After` value. Successful `200` responses and valid `304`
revalidations continue to populate the existing representation cache.

**Alternative considered:** Retry the failed request immediately or use a
feed-specific fallback. Rejected because either behavior increases upstream
load and the latter does not generalize to other sources.

### Decision 4: Do not claim global successful-request serialization

The existing in-flight promise map remains an isolate-local optimization, and
the Worker Cache API remains a data-center-local successful representation
store. D1 shares failure metadata only. A cold successful request in another
data center may still perform its own upstream fetch, which is an explicit
boundary of this change.

This keeps D1 out of the successful response path and avoids returning an error
to a user merely because another location is currently filling its cache.

### Decision 5: Clear active local state without adding success-path writes

The local failure record is cleared after a successful representation fetch or
revalidation. The shared record is cleared when this isolate has an active
local failure record to clear; already-expired shared records are harmless and
are removed by the daily cron. This avoids a D1 `DELETE` for every successful
feed refresh while still removing the normal failure lifecycle created by the
same runtime.

## Risks / Trade-offs

- **[Risk] D1 is unavailable or slow** → Treat shared-state operations as best-effort and continue with local/cache behavior; never fail a feed solely because D1 failed.
- **[Risk] A public proxy can generate many unique failed URLs** → Store only fixed-size hashes, index retry timestamps, delete expired rows daily, and write shared state only after an upstream failure rather than on every request.
- **[Risk] One shared failure affects all users of the exact URL** → Scope the record to the complete URL hash and expire it using the same bounded retry policy; successful recovery removes local state and expired rows are pruned.
- **[Risk] Successful bodies remain data-center-local** → Document that this change shares failure suppression, not successful content or global single-flight behavior.
- **[Risk] A failure marker can replace an expired regional success entry** → The client already retains browser-local items, and the next allowed request repopulates the normal successful cache.
- **[Risk] Wall-clock differences affect retry timestamps** → Use the Worker request's current epoch time consistently for both D1 records and response `Retry-After` calculations.

## Migration Plan

1. Apply migration `0006_feed_fetch_failures.sql` through the existing deploy pipeline before shipping the Worker code.
2. Deploy the code; existing successful caches remain valid, and failure metadata starts empty and warms only after failed upstream attempts.
3. Run the existing daily cron to remove expired failure rows.
4. Roll back by deploying the previous code if needed; the additive table can remain in D1 and is ignored by older code.

## Open Questions

None.
