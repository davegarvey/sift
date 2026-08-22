## Context

Three GitHub Actions workflows manage CI, Docker publishing, and releases:

- `ci.yml` — runs on PRs, push to main, and tag pushes; also callable as a reusable workflow
- `publish-ghcr.yml` — triggers on push to main and tags; calls `ci.yml` then builds + pushes a multi-arch Docker image to GHCR
- `release.yml` — triggers on PR merge to main; bumps version, creates release branch, pushes tag (immediately), creates release PR, auto-merges it

Current problems: every merged PR triggers a Docker publish (unnecessary), CI runs twice after merge (standalone push trigger + nested call from publish-ghcr), `ci.yml` push tag trigger duplicates CI on tag pushes, and tag pushes from `release.yml` fire the Docker publish before the release PR merges.

## Goals / Non-Goals

**Goals:**
- Docker publish only runs on version tags, not on every PR merge
- CI runs once per trigger, never duplicate
- Tag pushes happen after the release PR merges (so Docker publish only fires when CI on the release PR has passed)
- Non-code changes (docs, config, meta) skip CI and Docker publish

**Non-Goals:**
- Restructuring the release automation logic (grubble)
- Changing the multi-arch build setup

## Decisions

1. **Drop `push: branches: [main]` from `publish-ghcr.yml`** — Docker images are only meaningful on releases. Users who need the latest can use `workflow_dispatch`. Saves ~3-5 minutes of CI + ~10-15 minutes of multi-arch Docker build per merged PR.

2. **Remove all `push` triggers from `ci.yml`** — CI runs on every PR and is called as a `workflow_call` from `publish-ghcr.yml`. The `push: branches: [main]` trigger adds a redundant run after every merge. The `push: tags` trigger duplicates the CI run that `publish-ghcr.yml` already triggers via `workflow_call`. Removing both eliminates all duplicate CI.

3. **Add `paths-ignore` to both workflows** — documentation-only changes should not trigger CI or Docker builds. Use broad patterns: `**/*.md`, `LICENSE`, `openspec/**`, `.opencode/**`.

4. **Split `release.yml` into two jobs** — The naive fix (reordering tag push after `gh pr merge`) doesn't work because `gh pr merge --auto --merge` enables auto-merge and returns immediately — it doesn't wait for the actual merge. Instead:
   - `create-release` job (on feature PR merge): bump version, create release branch, create PR, set auto-merge. No tag push.
   - `push-tag` job (on release PR merge): extract version from `package.json`, create + push the git tag. This fires only after CI on the release PR has passed, since the PR merge requires CI to be green.

## Risks / Trade-offs

- **`push-tag` job runs after release PR merge** — If the merge happens but the tag push fails (network blip), the Docker publish won't fire. Mitigation: `workflow_dispatch` on publish-ghcr or manual tag push.
- **`paths-ignore` could miss a file type** — Patterns are broad but not exhaustive. Mitigation: keep patterns simple and adjust if needed.
