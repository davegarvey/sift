## Why

The automated release workflow (`release.yml`) creates `release/vX.Y.Z` branches, opens auto-merged PRs, and pushes `v*.*.*` tags when feature PRs merge to `main`. But there's no guard preventing local tools (AI agents, scripts, manual commands) from doing the same — editing `package.json`, committing as `grubble-bot`, pushing `chore/bump-*` branches, or pushing tags directly. This creates duplicate bump commits, redundant PRs, and confusing history, as happened with v0.43.0.

## What Changes

- Add a GitHub branch ruleset that blocks tag creation (`v*.*.*`) from all actors except the `RELEASE_PAT` / GitHub Actions.
- Add a policy entry to `AGENTS.md` stating version bumps are automated and local `grubble` runs must not happen.
- Remove the `grubble-bot` identity from `.git/config` to prevent local commits from masquerading as automated workflow commits.

## Capabilities

### New Capabilities
- `release-push-guard`: Rules and mechanisms preventing unauthorized pushes to release branches and tag creation outside the release workflow.

### Modified Capabilities
*(none — this is an infrastructure/policy change, not a feature-level requirement change)*

## Impact

- `.github/` — branch ruleset configured via GitHub UI/CLI
- `AGENTS.md` — new policy entry
- `.git/config` — remove `grubble-bot` identity
