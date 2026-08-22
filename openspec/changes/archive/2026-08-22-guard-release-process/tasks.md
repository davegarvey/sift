## 1. Remove grubble-bot identity from local git config

- [x] 1.1 Update `.git/config` to remove the `[user]` section (name=grubble-bot, email=grubble-bot@noreply.local) so local commits use the developer's global git identity

## 2. Create GitHub rulesets

- [x] 2.1 Create a "Release tags" ruleset targeting `v*.*.*` tags that restricts creation to the `RELEASE_PAT` identity
- [x] 2.2 Create a "Release branches" ruleset targeting `release/v*` branches with creation, update, and deletion restricted to the release workflow token

## 3. Update AGENTS.md

- [x] 3.1 Add policy entry stating version bumps are fully automated via the release workflow and local `grubble` runs must not be performed

## 4. Verify

- [x] 4.1 Confirm local git config no longer has `grubble-bot` identity
- [x] 4.2 Confirm the rulesets are active in the GitHub repo settings
- [x] 4.3 Run `npm run typecheck` to ensure no breakage

## 5. Workflow alignment

- [x] 5.1 Update `push-tag` job to use `RELEASE_PAT` for checkout auth, so tag pushes bypass the ruleset
- [x] 5.2 Update `create-release` checkout to use `RELEASE_PAT`, so release branch pushes bypass the ruleset on the user-owned repository
