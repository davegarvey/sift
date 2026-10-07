## ADDED Requirements

### Requirement: Sync IP limits use a trusted client address

On Cloudflare Workers, sync routes that apply an IP-based rate limit SHALL key that limit using `CF-Connecting-IP`. They SHALL ignore `X-Forwarded-For`, which the caller can supply. If `CF-Connecting-IP` is absent, the routes SHALL use a shared fallback key rather than accepting a caller-supplied address.

#### Scenario: Caller-supplied forwarded address does not change the limit key

- **WHEN** a sync request includes `X-Forwarded-For` but no `CF-Connecting-IP`
- **THEN** the rate limiter SHALL use the shared fallback key

#### Scenario: Cloudflare client address takes precedence

- **WHEN** a sync request includes both `CF-Connecting-IP` and `X-Forwarded-For`
- **THEN** the rate limiter SHALL use `CF-Connecting-IP`
