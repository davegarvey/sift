## 1. Workflow Trigger Changes

- [x] 1.1 Remove all `push` triggers from `ci.yml` (both `branches: [main]` and `tags: ['v*.*.*']`)
- [x] 1.2 Remove `branches: [main]` from `publish-ghcr.yml` triggers
- [x] 1.3 Add `paths-ignore` to `ci.yml` pull_request trigger (implemented, then reverted in `7d127ff` — docs-only PRs never reported the required `test` check, blocking branch protection; CI now runs on all PRs)
- [x] 1.4 Add `paths-ignore` to `publish-ghcr.yml` push trigger

## 2. Release Workflow Split

- [x] 2.1 Rename existing job to `create-release` and remove `git push --tags --force` step
- [x] 2.2 Add `push-tag` job for release PR merges that extracts version from `package.json` and pushes the tag

## 3. Verification

- [x] 3.1 Run `npm run typecheck` and `npm run lint` pass (workflow changes only, no code changes)
- [x] 3.2 Push branch and verify workflows render correctly in GitHub UI (dry run)
