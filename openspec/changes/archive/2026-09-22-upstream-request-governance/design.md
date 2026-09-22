## Context

See `proposal.md` for motivation. The browser scheduler starts a background sweep at startup, checks for due feeds every five minutes, and allows four concurrent refreshes per tab. Its cadence learner currently receives the complete parsed snapshot. The server caches only `/feed` success bodies for 15 minutes; local in-flight coalescing is per isolate. The Worker Cache API is data-center-local, while D1 already stores hashed per-URL failure cooldowns. Article, image, discovery, and MCP fetches use the shared safe upstream transport but bypass feed-cache coordination.

Cloudflare documents the Cache API as data-center-local and D1 batches as sequential transactional operations. This makes D1 suitable for small shared origin reservations at the current request volume; a Durable Object would add a second coordination primitive before measurements justify it.

## Goals / Non-Goals

**Goals:**

- Reduce accidental refresh bursts and keep one origin's outbound requests within a shared, bounded policy.
- Share Worker origin pacing and cooldowns across isolates and cache locations without storing upstream content or raw URLs in D1.
- Keep Node/Bun support through a runtime-local fallback.
- Make the source and retry state of `429` and `419` responses visible without logging content or subscription URLs.
- Distinguish upstream error responses from Sift-generated cooldowns through privacy-safe request provenance.

**Non-Goals:**

- Move feed parsing, articles, images, or reading state into D1.
- Make successful feed bodies globally replicated; the Worker Cache API remains a regional fast path.
- Add a new global crawler or scheduled feed-polling service.
- Add provider-specific fetch paths, request-header overrides, retry policies, or URL rewrites.

## Decisions

### Use a shared origin reservation, with D1 on Workers

Define the coordination key from normalized scheme, hostname, and effective port. Before an actual upstream request, acquire an atomic reservation for that origin. Apply the same policy to `/feed`, `/article`, `/img`, discovery, MCP, and every redirect hop. Cache hits do not reserve a slot because they do not contact the origin.

The Worker uses a small D1 table keyed by a hash of the origin. A single conditional write or transaction reserves the next allowed request time and observes any active origin cooldown. Store only the hash, next slot, cooldown status and expiry, challenge count, and cleanup timestamp. Do not persist a URL, response, or user identifier. Bound any wait queue; when a slot exceeds the queue limit, return a local `429` with `Retry-After` and a diagnostic source marker.

Node/Bun use the same policy through process-local state. If D1 is unavailable, the Worker uses its runtime-local gate and cooldown state; this is the existing availability fallback. Avoid a Durable Object for now: D1 is already bound, requests are infrequent after cache hits, and D1's transactional writes provide the shared reservation needed here. Reconsider a Durable Object if metrics show D1 latency or write volume is material.

### Keep successful bodies in the existing cache layers

Retain the 15-minute feed representation policy for this change and keep Worker Cache API entries data-center-local. Do not put response bodies in D1. Use distinct Worker Cache API keys or namespaces for success representations and cooldown markers so a 429/419 marker cannot replace a cached body or its validators.

### Apply conservative status cooldowns

Keep existing URL-level cooldown behavior for ordinary upstream failures. Add an origin-level circuit for `429` and the observed `419` challenge signal. A valid `Retry-After` always establishes a minimum wait, even if longer than the existing 24-hour URL retry cap. For `419` without that header, start at six hours and increase repeated challenge cooldowns up to 24 hours. Return the effective Sift-generated delay in `Retry-After` on the initial response as well as cooldown responses. Keep local manual refresh behind the same server cooldown.

Apply `Cache-Control: no-store` to all proxy errors. Keep `/img`'s long-lived immutable policy for successful images only. Preserve the existing successful `/feed` response and validator behavior.

### Correct cadence learning and add stable jitter

Calculate cadence from new item IDs and elapsed time between successful observations. A feed's current snapshot size and the age of its newest item are not valid substitutes for that measurement. Spread due times with a stable offset derived from feed identity; the offset may delay a refresh, never advance it before the learned interval.

### Expose safe request provenance

Add a response source classification for upstream, URL cooldown, origin cooldown, and local-gate responses. Preserve status and `Retry-After` where applicable. Persist only hashed origin/URL keys and coarse route/status/timing data. Do not record response bodies, query strings, article IDs, or raw URLs. This lets a user distinguish a first upstream challenge from a Sift cooldown replay.

### Diagnose nonstandard upstream errors without provider-specific behavior

A `419` is not an assigned HTTP status code, so the number alone does not identify which server or intermediary generated it or what condition triggered it. The request path explicitly sets Sift's User-Agent; feed revalidation may also send ETag or Last-Modified validators. A successful direct request from a client does not isolate source IP from request-header differences. Record generic upstream-versus-local response provenance and allowlisted response metadata, then compare controlled requests if needed. Keep Sift's client identity truthful and do not imitate browser headers.

## Risks / Trade-offs

- **[Risk] D1 reservation writes add latency and database usage to cache misses** → Reserve only immediately before an upstream request; serve successful cache hits without D1 coordination; measure write volume and latency.
- **[Risk] A host-wide 419 cooldown delays unrelated paths on the same origin** → Limit origin-wide activation to 429 and 419, keep it bounded, and expose the cooldown source and expiry.
- **[Risk] D1 becomes unavailable** → Use the runtime-local gate and preserve feed availability, while recording a privacy-safe coordination-fallback diagnostic.
- **[Risk] Stable jitter adds visible refresh delay** → Never schedule before the configured learned interval and keep jitter bounded.
- **[Risk] A 419 has provider-specific meaning** → Treat it as an unclassified upstream refusal signal, record its provenance, and apply a bounded origin cooldown without claiming that the status alone proves a ban.

## Migration Plan

1. Add the D1 origin-policy migration and scheduled cleanup for expired cooldown/reservation rows.
2. Deploy server-side gating and safe diagnostics. Existing URL cooldown rows remain valid and body caches warm naturally.
3. Deploy the browser cadence and retry changes with the server policy.
4. Observe origin reservations, cooldowns, cache outcomes, and D1 cost without recording raw URLs.
5. Roll back by disabling the D1 origin gate and retaining runtime-local policy; leave the additive table in place.
