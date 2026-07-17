## ADDED Requirements

### Requirement: Tag creation restricted to workflow actors

The system SHALL block creation of `v*.*.*` tags from all actors except `RELEASE_PAT` and GitHub Actions.

#### Scenario: Workflow pushes tag successfully
- **WHEN** the `push-tag` job in `release.yml` runs `git push origin "v${VERSION}"`
- **THEN** the tag SHALL be created on the remote

#### Scenario: Local actor attempts tag push
- **WHEN** a developer or AI agent runs `git push origin v0.44.0` from a local machine
- **THEN** the push SHALL be rejected by the remote

#### Scenario: Local actor pushes non-version tag
- **WHEN** a developer pushes a tag that does not match `v*.*.*` (e.g., `test-tag`, `v0.x`)
- **THEN** the push SHALL be allowed

### Requirement: Release branch pushes restricted

The system SHALL block pushes to `release/v*` branches from all actors except `RELEASE_PAT` and GitHub Actions. Pull requests from these branches SHALL still be creatable.

#### Scenario: Workflow pushes release branch successfully
- **WHEN** the `create-release` job in `release.yml` runs `git push --set-upstream origin "release/v${VERSION}"`
- **THEN** the branch SHALL be created on the remote

#### Scenario: Local actor pushes to release branch
- **WHEN** a developer runs `git push origin release/v0.44.0` from a local machine
- **THEN** the push SHALL be rejected by the remote

### Requirement: Local git identity not set to grubble-bot

The local repository git config SHALL NOT have `user.name` or `user.email` set to `grubble-bot` or `grubble-bot@noreply.local`.

#### Scenario: Developer clones repository fresh
- **WHEN** a developer runs `git clone` and checks `.git/config`
- **THEN** the `[user]` section SHALL either be absent (inheriting global config) or set to the developer's own identity

### Requirement: Policy documented in AGENTS.md

The `AGENTS.md` file SHALL contain an entry documenting that version bumps are automated and local `grubble` runs must not be performed.

#### Scenario: Agent reads AGENTS.md before acting
- **WHEN** an AI agent reads `AGENTS.md`
- **THEN** the entry SHALL clearly state that version bumps are automated and manual/agent-initiated bumps should not be performed
