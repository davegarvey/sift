# Proposal: chat-agent-read-access

## Why

The Agents modal promises that pasting a pairing code into a chat tool (ChatGPT, Claude) lets the agent manage feeds. In practice this fails: hosted chat tools run in sandboxes that cannot POST to `/sync/tokens/redeem` or send authenticated headers, so neither ChatGPT nor Claude web can pair or read. The modal's primary flow is broken; only `siftctl` and local coding agents work today.

## What Changes

- **GET pull with a pairing code.** `GET /sync/pull?code=<agent code>` reads feeds and items without headers or a token. The code is the credential: multi-use until its 5-minute expiry (codes are currently single-use), read-only by construction, and gone on expiry. Per-IP and per-(IP, code) brute-force guards use in-memory counters — zero persistent writes on the guess path, so distributed guessing cannot exhaust the D1 write quota. All pull responses carry `Cache-Control: no-store`.
- **Rotation is a true kill switch.** Token authentication gains a cross-check that the token's sync key still exists in `users`, so rotating the sync key orphans every agent token — the claimed remediation becomes real.
- **Intent URLs for writes.** An agent that wants to add a feed emits a clickable link `{origin}/?intent=add&url=<feed-url>`. Clicking opens the app with the add-feed modal prefilled (value passed through untouched; validation happens at discovery, exactly as in the manual flow); discovery only runs after the user clicks. Writes never leave the browser's authority; no credential is ever required to add a feed.
- **Proxy hardens against private targets.** The fetch proxy (shared by `/feed`, `/article`, `/img`) refuses loopback, private, link-local, and cloud-metadata targets — the intent-URL flow would otherwise turn it into a clickable SSRF link.
- **Rewritten agent prompt.** The copied prompt becomes a plain, Economist-style brief: bullets of what the agent can do (read feeds for 5 minutes, propose adds as clickable links), explicit constraints (read-only, expiry, human approval for adds). No POST redeem step, no token handling.
- **Docs.** `public/openapi.json` documents the `code` query param on pull and the intent URL format. README's agent-access section gains the hosted-chat flow and security notes.
- `POST /sync/tokens/redeem` and `siftctl` are unchanged — full read/write stays the terminal path.

## Capabilities

### New Capabilities
- `chat-agent-access`: read-only access for hosted chat agents — pairing-code pull, intent-URL adds, and the agent prompt contract.

### Modified Capabilities
- `device-sync`: the pull route gains a second authentication path (pairing code via query string) alongside bearer-token auth.

## Impact

- `server/sync/routes.ts` — pull route: code auth, rate limits, no-store; token auth cross-check in `server/sync/auth.ts`.
- `server/fetch.ts` — private/loopback/link-local/metadata target denial; URL-value log scrub.
- `src/state.tsx` — boot-time `?intent=add&url=` handler next to the existing `?pair=` handler.
- `src/components/AddFeedModal.tsx` — prefill from modal state; no auto-discovery.
- `src/components/AgentsModal.tsx` — rewritten prompt template and intro copy.
- `public/openapi.json`, `README.md` — API and flow documentation.
- Tests: code pull (ok / expired / wrong kind / rate-limited / multi-use / no-store), POST redeem still single-use, intent prefill.
- No schema changes; no breaking changes to existing flows.
