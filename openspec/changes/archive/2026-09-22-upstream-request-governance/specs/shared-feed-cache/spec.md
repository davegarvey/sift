## ADDED Requirements

### Requirement: Keep cooldown markers separate from successful feed representations

Worker Cache API entries for upstream failure cooldowns SHALL use a distinct cache key or namespace from successful feed representations. Recording a cooldown SHALL preserve any previously cached successful body and validators for a later revalidation.

#### Scenario: A 419 follows a cached feed response

- **WHEN** a stale successful feed representation is present and its upstream revalidation returns `419`
- **THEN** the cooldown marker SHALL be stored separately from the successful representation
- **AND** the successful body and validators SHALL remain available after the cooldown expires

#### Scenario: Cooldown marker expires

- **WHEN** an origin or URL cooldown marker expires
- **THEN** the successful representation cache entry SHALL remain independently readable until its own freshness policy expires
