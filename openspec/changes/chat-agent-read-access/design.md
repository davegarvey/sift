# Design: chat-agent-read-access

## Context

See proposal.md — Why. Current state: agent pairing codes (`pairing_codes`, kind `agent`, 8 chars, 5-minute TTL via `PAIRING_TTL_SECONDS`, single-use — deleted on redeem at `routes.ts:427`) are redeemed by `POST /sync/tokens/redeem` into 23-char `t`-prefixed tokens. `/sync/pull` (routes.ts:736) and `/sync/push` (routes.ts:478) share `requirePrincipal` auth middleware (routes.ts:257). Hosted chat tools (ChatGPT, Claude web) cannot POST or send auth headers — their only capability is fetching public GET URLs. The app already has a boot-time URL-param handler for `?pair=` (`state.tsx:586-605`), and the add-feed modal (`AddFeedModal.tsx`) is a two-step flow: URL input → user-triggered discovery → subscribe.

## Goals / Non-Goals

**Goals:**
- Let sandboxed chat agents read subscriptions via a plain GET with the pairing code in the query string.
- Let agents propose adds via clickable intent URLs; the browser performs writes with user approval.
- Zero tokens in chat history; codes self-revoke in 5 minutes.
- Single prompt template that works for ChatGPT, Claude web, and coding agents.

**Non-Goals:**
- No new scopes, no read-only token minting, no changes to `siftctl` or the POST redeem path (rw tokens stay the terminal's job).
- No intent types beyond add-feed (no remove/mark-read intents).
- No auto-discovery on intent load — the user must click.

## Decisions

### D1: The code is the credential — no token minting

`GET /sync/pull?code=<agent code>` resolves the code to its sync key and serves the pull. Rejected alternatives:

- **GET redeem that mints a token** — the agent would need to send the token as a header on follow-ups; neither ChatGPT nor Claude web can. It would also plant a permanent secret in chat history for no benefit.
- **Per-request code-capability only (no registration)** — chosen, and the "doesn't register" concern dissolves: the code is read-only by construction, expires in 5 minutes, and is rate-limited. Nothing to revoke.

The POST redeem path is untouched and still consumes the code (single-use). If a user POST-redeems the same code a chat agent is using, the chat session's reads die — acceptable and documented. One blast-radius gap this design closes: a code in chat history can be POST-redeemed into a permanent `rw` token by a compromised or injected agent. The kill switch is real rotation: `POST /sync/rotate` (old key in header, new key in body) marks the old key's `users` row `rotated_at` — master-key auth and agent-token auth reject rotated rows (401), `POST /sync/register` refuses to resurrect them (403), so a rotated key is permanently dead. Rotation orphans every token minted under the old key, and old-key devices must re-pair. The client's 401-auto-register path is removed so nothing can resurrect a rotated key (previously it would silently recreate the group).

### D2: Codes stay multi-use on the pull path

The pull path must NOT delete the code row on success — agents pull repeatedly with a `since=` cursor inside their session. Expired codes are still lazily deleted (reuse the redeem path's expiry-check-and-delete behavior). `isPairingCode` (8 chars) gates the lookup, with a `typeof value === 'string'` guard first (Hono returns the first duplicate param and `undefined` for `code[]`; both already fail the format check — the guard makes it explicit); only `kind='agent'` codes are accepted — device codes return 404.

### D3: New `authOrCode` middleware for `/sync/pull` only

`/sync/push` keeps `requirePrincipal` (a code can never write). Pull gets a sibling middleware: valid `X-Sync-Key` → existing principal; else `?code=` → validate + resolve syncKey with a read-only `{ kind: 'code' }` principal; else 401. The pull handler is unchanged after auth — same response shape, same per-syncKey rate limit. Unknown/expired/wrong-kind codes return 404 (matches redeem; avoids probing code validity). Malformed `code` param also 404.

### D4: In-memory brute-force guards — no persistent writes on the guess path

8 chars is guessable over hours, so attempts are limited per client IP and per (IP, code) before any code lookup. The guard is a windowed counter in worker memory (per-isolate), NOT the D1-backed `checkRateLimit`: every D1 limit hit does a SELECT plus an upsert write (`ratelimit.ts:32-47`), so a D1-backed guard would let a distributed guessing campaign burn the shared D1 write quota — turning the defense into a DoS amplifier. In-isolate counters cost nothing and still block a single source. Limits: per-IP `60/min`, per-(IP, code) `10/min` (an attacker rotating codes still hits the per-IP wall; one hammered code can't starve other codes from the same egress). On excess: 429 + `Retry-After`. Honest bounds: this slows a distributed attacker, it does not stop one — with a botnet, enumerating *some* valid 8-char code becomes a matter of hours; the damage is bounded (read-only, 5-minute expiry, per-syncKey pull limit still applies after resolution). The existing D1 per-syncKey pull limiter is unchanged.

### D5: `Cache-Control: no-store` on every pull response

Pull data (feed URLs, read flags) is personal, and a code rides in the URL — shared caches keyed on the URL could replay one user's state to another; the `X-Sync-Key` header does not trigger the Authorization caching rule (RFC 9111). Every pull response, header- or code-authenticated, sets `Cache-Control: no-store` — including the 404/429 responses on the code path.

### D6: Intent URLs — prefilled modal, no auto-fetch, pass-through value

`?intent=add&url=<feed>` on load: `openModal({ kind: 'add-feed', url })` with the raw value passed through untouched — no boot-time validation — then `history.replaceState` cleanup (mirroring the `?pair=` block at state.tsx:586-605). Validation happens exactly where it does today: `AddFeedModal.urlError()` gates the Discover button. `?intent=add` without `url` opens the modal empty (identical to the toolbar add-feed button). Modal kind grows to `{ kind: 'add-feed'; url?: string }` (state.tsx:38). `AddFeedModal` seeds its `url()` signal from `ctx.state.modal.url` when the modal is `add-feed` — it mounts only while that kind is active (App.tsx:182). No auto-discovery: the user clicks Discover, exactly as the two-step flow works today. The `url` param must be URL-encoded; `URLSearchParams` decodes.

### D7: Economist-style agent prompt

Short sentences, active voice, bullets, explicit constraints, no jargon. Draft (origin and code injected at copy time):

```
You are my Sift RSS agent.

What you can do
- Read my subscriptions and items. Fetch GET {origin}/sync/pull?code={code}
- Propose feeds to add. Send a link: {origin}/?intent=add&url=<feed-url>

Rules
- Access expires in 5 minutes.
- You cannot change my subscriptions. I approve each add by clicking its link.

Reference: {origin}/openapi.json
```

No token handling, no POST instructions. Modal intro copy ("Copy the prompt and paste it into a chat tool like ChatGPT…") is accurate again; the terminal/siftctl section is unchanged.

### D8: Docs

`public/openapi.json`: `code` query param on the pull operation (optional, mutually exclusive with the header), intent URL documented in the description. README: new "Hosted chat tools" flow under AI agents — reads via code, adds via intent links, security notes (code is read-only, 5 minutes, lives in chat history; add-links are user-approved; rotating the sync key orphans all tokens).

### D9: Feed-fetch proxy refuses private targets

Intent URLs turn the fetch proxy into a distributable link, so `getUpstreamUrl` (`server/fetch.ts:4-21`) — which today checks only the `http(s):` protocol — additionally denies loopback (`127.0.0.0/8`, `::1`), private ranges (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), link-local (`169.254/16`, `fe80::/10`), and the cloud-metadata address `169.254.169.254`, by literal host, IPv6 form, and resolved A/AAAA records. Refused targets fail before any upstream request. This hardens `/feed`, `/article`, and `/img` for everyone; the app targets public feeds only, so no legitimate use is lost. Also fixes a pre-existing AGENTS.md violation: the parse-failure log at `server/fetch.ts:13` prints the upstream URL value — it logs the warning without the value.

## Risks / Trade-offs

- **Code in chat history is a permanent read-capability until expiry** → bounded to 5 minutes, read-only, in-memory rate-limited per IP and per (IP, code); rotation (`/sync/rotate` + `rotated_at` + register refusal + no client auto-register) permanently orphans every token, including any `rw` token a compromised agent POST-redeemed.
- **Code guessability** (8 chars) → per-IP and per-(IP, code) limits before lookup with zero persistent writes (no D1-quota amplification); 404s don't confirm existence; codes expire. A resourced distributed attacker can still enumerate *some* user's code in hours — read-only impact, documented honestly.
- **Chat-provider egress pools share IPs** → per-(IP, code) keying contains collateral: one busy agent can't starve other codes behind the same NAT; per-IP limit only bites under active guessing.
- **POST-redeem of a shared code kills the chat session's reads, and can escalate to rw** → rotation permanently orphans all tokens (rotated rows rejected by master and token auth; register refuses them); Settings token list + revoke remains the immediate control; README documents.
- **Rotation changes group semantics** → old-key devices get 401 and must re-pair with the new key (the stolen-device recovery flow); the 401-auto-register path is removed so nothing resurrects a rotated key. This is a deliberate breaking change.
- **Proxy SSRF via intent links** → D9 denies private/loopback/metadata targets; user still clicks Discover before any fetch, and the app is a public-feeds reader.
- **A runaway or captured agent can spend the owner's per-syncKey pull budget** → acceptable; README sentence.
- **ChatGPT web access is best-effort and may not always fetch** → the flow also works with Claude web and coding agents; siftctl remains the guaranteed path.
- **Intent URL is a link anyone can click** → it only opens a prefilled modal; no write happens without the user clicking Discover + Subscribe.

## Migration Plan

Additive server change (new query param on pull, `rotated_at` column via migration `0004_sync.sql` + `ensureSchema`, new `/sync/rotate` route) + client intent handling and rotation wiring. Breaking changes (allowed): the 401-auto-register path is removed, and rotating a sync key now kills the old key permanently (devices re-pair). Apply `0004_sync.sql` to D1 before/with the Worker deploy (`npx wrangler d1 migrations apply sift-sync --remote`). Old clients ignore the new param; siftctl unaffected. The proxy target denial is the only behavior change for existing public-feed users.
