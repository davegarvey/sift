## Purpose

Lets hosted chat agents (ChatGPT, Claude web) inspect a user's subscriptions and propose additions without holding credentials: reads use a short-lived pairing code on the pull endpoint, and writes happen through clickable intent URLs the user approves in the browser.

## ADDED Requirements

### Requirement: Read-only pull with a pairing code

The system SHALL accept an agent pairing code on `GET /sync/pull` through the `code` query parameter as an alternative to the `X-Sync-Key` header. The code SHALL grant read-only access — feeds and flags — scoped to the sync key it was minted for. A valid code SHALL remain usable for repeated pulls until its expiry (the server SHALL NOT consume it). The server SHALL respond with HTTP 404 for unknown, wrong-kind, or expired codes, and SHALL NOT mint or return tokens on this path. Code-authenticated responses SHALL include `Cache-Control: no-store`.

#### Scenario: Pull with a valid unexpired code

- **WHEN** a client requests `GET /sync/pull?code=<valid unexpired agent code>`
- **THEN** the server SHALL respond with HTTP 200
- **AND** the response SHALL contain the feeds, flags, and `serverTime` scoped to the code's sync key, in the same shape as a header-authenticated pull

#### Scenario: Code survives repeated pulls

- **WHEN** a client requests `GET /sync/pull?code=<valid code>` more than once before expiry
- **THEN** each request SHALL succeed
- **AND** the code SHALL remain valid for later pulls

#### Scenario: Pull with an expired code

- **WHEN** a client requests `GET /sync/pull?code=<code past its expiry>`
- **THEN** the server SHALL respond with HTTP 404
- **AND** SHALL NOT return any user data

#### Scenario: Pull with an unknown code

- **WHEN** a client requests `GET /sync/pull?code=<unrecognized string>`
- **THEN** the server SHALL respond with HTTP 404

#### Scenario: Pull with a device-pairing code

- **WHEN** a client requests `GET /sync/pull?code=<a device-pairing code rather than an agent code>`
- **THEN** the server SHALL respond with HTTP 404
- **AND** SHALL NOT expose any user data

#### Scenario: Code-authenticated response is not cached

- **WHEN** a client requests `GET /sync/pull?code=<valid code>`
- **THEN** the response SHALL include `Cache-Control: no-store`

### Requirement: Brute-force protection on code pulls

The system SHALL rate-limit code-authenticated pull attempts per client IP and per client-IP-and-code pair, to slow guessing of the 8-character code. The limits SHALL be enforced with in-memory state and SHALL NOT write to persistent storage on each attempt — the guard must not amplify a distributed guessing campaign into a storage-quota drain. The per-IP limit SHALL apply before any code lookup. Exceeding a limit SHALL return HTTP 429 with `Retry-After`.

#### Scenario: Attempts within the limit succeed

- **WHEN** a client performs code-authenticated pulls within the per-IP and per-(IP, code) limits
- **THEN** each request SHALL be evaluated normally

#### Scenario: Attempts beyond the limit are refused

- **WHEN** a client exceeds the per-IP limit for code-authenticated pulls
- **THEN** the server SHALL respond with HTTP 429
- **AND** the response SHALL include a `Retry-After` header

#### Scenario: Guard does not consume persistent storage

- **WHEN** an attacker performs code-authenticated pull attempts
- **THEN** the enforcement SHALL NOT write a row to persistent storage per attempt

#### Scenario: Hammering one code does not block other codes

- **WHEN** a client repeatedly attempts the same code beyond the per-(IP, code) limit
- **THEN** only that client-and-code pair SHALL be refused
- **AND** other codes from the same client IP SHALL remain within their per-IP budget

### Requirement: Intent URL for adding a feed

The app SHALL handle an `intent=add` query parameter with a `url` parameter on load: it SHALL open the add-feed modal with the URL prefilled. The URL SHALL be passed through unvalidated — the existing discovery-time validation (http/https only, via the modal's normal flow) SHALL be the only gate. The app SHALL NOT fetch, discover, or otherwise request the URL as a side effect of loading — discovery SHALL run only after the user acts. An `intent=add` without a `url` parameter SHALL open the modal empty. After handling, the app SHALL remove the intent parameters from the address bar.

#### Scenario: Valid intent opens the prefilled modal

- **WHEN** the app loads with `?intent=add&url=<feed URL>`
- **THEN** the add-feed modal SHALL open with the URL prefilled
- **AND** the address bar SHALL be cleaned of the intent parameters

#### Scenario: Intent does not auto-fetch

- **WHEN** the app loads with `?intent=add&url=<feed URL>`
- **THEN** no network request for that URL SHALL be initiated until the user clicks the discovery control

#### Scenario: Intent with a non-http(s) value

- **WHEN** the app loads with `?intent=add&url=<value that is not http(s)>`
- **THEN** the modal SHALL open prefilled with the value
- **AND** SHALL surface the existing URL validation error when the user attempts discovery

#### Scenario: Intent without a url parameter

- **WHEN** the app loads with `?intent=add` and no `url` parameter
- **THEN** the add-feed modal SHALL open empty
- **AND** the address bar SHALL be cleaned of the intent parameters

### Requirement: Feed-fetch proxy refuses private targets

The feed-fetch proxy (`/feed`, `/article`, `/img`) SHALL refuse targets whose host is a loopback, private, link-local, or cloud-metadata address, and SHALL refuse targets resolved to such addresses. Refused targets SHALL fail without any upstream request.

#### Scenario: Loopback target refused

- **WHEN** a client requests an upstream URL whose host is `127.0.0.1` or `::1`
- **THEN** the proxy SHALL respond with an error
- **AND** SHALL NOT make an upstream request

#### Scenario: Private and metadata targets refused

- **WHEN** a client requests an upstream URL whose host is in a private range (`10/8`, `172.16/12`, `192.168/16`, ULA `fc00::/7`) or a cloud-metadata address (`169.254.169.254`)
- **THEN** the proxy SHALL respond with an error
- **AND** SHALL NOT make an upstream request

#### Scenario: Public target still fetched

- **WHEN** a client requests an upstream URL whose host resolves to a public address
- **THEN** the proxy SHALL fetch and return it as before

### Requirement: Agent prompt contract

The prompt the user copies from the Agents modal SHALL state, in plain language: the agent can read the user's feeds and items by fetching `GET {origin}/sync/pull?code={code}`; this access expires after 5 minutes; the agent cannot write to subscriptions; to add a feed the agent SHALL reply with a clickable link of the form `{origin}/?intent=add&url=<feed-url>` that the user clicks to approve. The prompt SHALL NOT instruct the agent to redeem codes, handle tokens, or POST to the sync API.

#### Scenario: Prompt contains the read instruction

- **WHEN** the user copies the agent prompt
- **THEN** it SHALL contain the pull URL with the current pairing code

#### Scenario: Prompt contains the constraints

- **WHEN** the user copies the agent prompt
- **THEN** it SHALL state the 5-minute expiry
- **AND** SHALL state that the agent cannot write subscriptions directly

#### Scenario: Prompt contains the intent-link instruction

- **WHEN** the user copies the agent prompt
- **THEN** it SHALL instruct the agent to propose additions as clickable intent URLs

#### Scenario: Prompt omits token handling

- **WHEN** the user copies the agent prompt
- **THEN** it SHALL NOT mention token redemption or authentication headers
