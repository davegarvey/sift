## ADDED Requirements

### Requirement: Existing automated release branches are refreshed safely

When a release PR for the version selected by the release workflow already exists, the workflow SHALL update that branch by merging the current `main` into it using the authorized workflow identity. It SHALL preserve the generated version bump, push without rewriting protected history, and reuse the existing PR.

#### Scenario: A feature merges while its release PR is already open

- **WHEN** another feature PR merges while a release PR for the same version is open
- **THEN** the release workflow SHALL merge current `main` into the existing release branch, retain the version bump, and update that PR
- **AND** it SHALL NOT try to recreate or force-push the protected release branch

#### Scenario: A release branch does not exist

- **WHEN** the release workflow selects a version with no existing release branch
- **THEN** it SHALL create the branch from current `main` and open one release PR
