## ADDED Requirements

### Requirement: CI runs on pull requests and when called as a reusable workflow, not on push to main

The system SHALL trigger CI on pull requests targeting `main` and when called as a reusable workflow. The system SHALL NOT trigger CI on plain pushes to `main` or on tag pushes (tag-push CI is handled by `publish-ghcr.yml` calling CI as a reusable workflow).

#### Scenario: PR opened against main triggers CI
- **WHEN** a pull request targeting `main` is opened
- **THEN** the CI workflow SHALL run

#### Scenario: PR push triggers CI
- **WHEN** new commits are pushed to a pull request targeting `main`
- **THEN** the CI workflow SHALL run

#### Scenario: Push to main without tag does NOT trigger CI
- **WHEN** commits are pushed directly to `main` (e.g. via merge commit) without a version tag
- **THEN** the CI workflow SHALL NOT run

#### Scenario: Tag push triggers CI via publish-ghcr
- **WHEN** a tag matching `v*.*.*` is pushed
- **THEN** the CI workflow SHALL run via the `publish-ghcr.yml` workflow's reusable call, not via a direct `push` trigger

### Requirement: Docker publish only on tags, not on every push to main

The system SHALL build and push a Docker image to GHCR only when a version tag is pushed or when triggered manually. The system SHALL NOT publish on plain pushes to `main`.

#### Scenario: Tag push publishes Docker image
- **WHEN** a tag matching `v*.*.*` is pushed
- **THEN** the Docker image SHALL be built and pushed to GHCR

#### Scenario: Push to main without tag does NOT publish
- **WHEN** commits are pushed to `main` without a version tag
- **THEN** the Docker image SHALL NOT be built or pushed

#### Scenario: Manual dispatch publishes Docker image
- **WHEN** the workflow is triggered via `workflow_dispatch`
- **THEN** the Docker image SHALL be built and pushed to GHCR

### Requirement: Non-code changes skip CI and Docker publish

The system SHALL skip CI and Docker publish when only documentation, configuration, or meta files are changed.

#### Scenario: Documentation-only PR skips CI
- **WHEN** a pull request only changes files matching `**/*.md`, `LICENSE`, `openspec/**`, or `.opencode/**`
- **THEN** the CI workflow SHALL NOT run

#### Scenario: Code change PR runs CI normally
- **WHEN** a pull request changes at least one file not matching the ignore patterns
- **THEN** the CI workflow SHALL run

#### Scenario: Documentation-only tag push skips Docker publish
- **WHEN** a tag push only changes files matching the ignore patterns
- **THEN** the Docker publish workflow SHALL NOT run

### Requirement: Release tag pushed only after release PR merges

The system SHALL push the version tag to the remote only in a distinct job that runs on release PR merges, ensuring the Docker publish only fires once CI on the release PR has passed.

#### Scenario: Feature PR merge creates release but does not push tag
- **WHEN** a non-release pull request is merged to `main`
- **THEN** the `create-release` job SHALL bump the version, create a release branch, create a release PR, and set auto-merge — but SHALL NOT push the version tag

#### Scenario: Release PR merge pushes the tag
- **WHEN** a release pull request (from a `release/` branch) is merged to `main`
- **THEN** the `push-tag` job SHALL push the version tag to the remote

#### Scenario: Docker publish runs after passing CI
- **WHEN** the version tag is pushed (which happens via the `push-tag` job after release PR merge)
- **THEN** the Docker publish workflow SHALL run CI and build the image only after the tag is available
