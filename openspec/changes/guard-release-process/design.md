## Context

The release pipeline uses two GitHub Actions jobs: `create-release` (runs on feature PR merge → bumps version, creates `release/v*` branch + PR) and `push-tag` (runs on release PR merge → pushes `v*.*.*` tag → triggers Docker publish to GHCR).

The local git config (`./.git/config`) has `user.name = grubble-bot` and `user.email = grubble-bot@noreply.local`, and `grubble` is installed at `~/.cargo/bin/grubble`. This means any local git commit (manual, scripted, or by an AI agent) uses the bot identity and can push branches/tags that collide with the automated workflow.

Three things need to change: a GitHub-side access control (the only reliable guard), removal of the misconfigured local identity, and documentation.

## Goals / Non-Goals

**Goals:**
- Prevent non-workflow actors from pushing `v*.*.*` tags to the remote.
- Prevent non-workflow actors from pushing `release/v*` branches.
- Remove the `grubble-bot` identity from the local git config so local commits use the developer's identity.
- Document the policy so AI agents and humans know not to bump locally.

**Non-Goals:**
- Changing the release workflow itself (it works correctly).
- Blocking all `chore/bump-*` branch pushes (low value, false positives).
- Blocking humans from intentionally bumping versions (they have GitHub admin access and can override rulesets).

## Decisions

### 1. GitHub branch ruleset over pre-push hooks
A GitHub branch ruleset is enforceable server-side and applies to all actors (CLI, web, API). A pre-push hook lives in `.git/hooks/`, is not distributed by default, and is bypassable with `--no-verify`.

### 2. Tag protection via ruleset "Restrict creations" 
GitHub branch rulesets can block tag creation. We'll create a ruleset targeting `v*.*.*` tags that only permits `RELEASE_PAT` (the same token used in the release workflow) and GitHub Actions to create tags.

### 3. Remove bot identity from `.git/config`
The `grubble-bot` user in the local git config is a trap — any local commit (even unrelated work) uses this identity. Removing it means local commits use the developer's global git config. If `grubble` is run locally, the commit will be attributed to the developer, making it clearly distinguishable from workflow commits.

## Risks / Trade-offs

- **[Ruleset not replicated]** The GitHub ruleset is configured via the GitHub UI/CLI, not in-repo. If the repo is migrated or recreated, the ruleset must be manually re-applied. → Document the ruleset setup in `AGENTS.md`.
- **[Developer friction]** A developer who needs to create a release tag for an emergency hotfix must either (a) push via the workflow or (b) temporarily disable the ruleset. → This is intentional; the workflow is the correct path.
- **[Ruleset bypass]** GitHub admins (repo owners) can override rulesets. → Acceptable — this guard is for accidental/automated collisions, not malicious actors.
