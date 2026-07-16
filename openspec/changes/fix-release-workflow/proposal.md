## Why

The release pipeline wastes time and resources: `publish-ghcr.yml` builds and pushes a multi-arch Docker image on every push to `main` (every merged PR), CI runs twice after every merge (standalone + nested in publish-ghcr), and `release.yml` pushes git tags before the release PR merges — triggering an untrusted Docker publish that could race ahead of failed CI.

## What Changes

- `publish-ghcr.yml`: Remove `branches: [main]` trigger; only publish on tag pushes and manual dispatch
- `ci.yml`: Remove all `push` triggers (CI runs on PRs and is called as a reusable workflow from publish-ghcr)
- Both workflows: Add `paths-ignore` to skip CI/publish on non-code changes (docs, config, meta files)
- `release.yml`: Split into two jobs — `create-release` (feature PR merged → bump, create branch/PR, auto-merge, NO tag push) and `push-tag` (release PR merged → push the version tag), so the Docker publish only fires once CI on the release PR has passed

## Capabilities

### New Capabilities
- `release-ci-pipeline`: Pipeline orchestration for release — when CI runs, when Docker publishes, and how they relate to each other

### Modified Capabilities

None (no existing specs).

## Impact

- `.github/workflows/ci.yml` — remove push triggers, add paths-ignore
- `.github/workflows/publish-ghcr.yml` — change triggers, add paths-ignore
- `.github/workflows/release.yml` — two jobs instead of one; no tag push from create-release
