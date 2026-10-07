# ghcr-publish Specification

## Purpose

Publish a multi-architecture Sift container image to GitHub Container Registry from the release workflow, authenticated with the workflow token and using build caching.

## Requirements

### Requirement: Automated image build and push
The system SHALL build and publish a multi-architecture container image to GitHub Container Registry on version tags matching `v*.*.*` and on manual dispatch. Version releases SHALL publish a semantic-version tag and `latest`. The package SHALL be public so users can pull the image without GitHub authentication.

#### Scenario: Push to main triggers build
- **WHEN** a commit is pushed to the `main` branch
- **THEN** the workflow SHALL build the Docker image for `linux/amd64` and `linux/arm64`
- **THEN** the workflow SHALL push a multi-arch manifest to `ghcr.io/<owner>/sift:main`
- **THEN** the workflow SHALL push a multi-arch manifest tagged with the short commit SHA

#### Scenario: Version tag triggers build
- **WHEN** a tag matching `v*.*.*` is pushed
- **THEN** the workflow SHALL build and push a multi-arch manifest tagged with the tag name (e.g., `v1.0.0`)
- **AND** it SHALL publish the corresponding semantic-version tag and `latest`

#### Scenario: Manual workflow dispatch
- **WHEN** the workflow is triggered via `workflow_dispatch` from the GitHub UI
- **THEN** the workflow SHALL build and push images using the same logic as a branch push

#### Scenario: Anonymous pull
- **WHEN** an unauthenticated user pulls `ghcr.io/<owner>/sift:latest`
- **THEN** the package SHALL serve the image manifest without requiring sign-in

### Requirement: Multi-architecture support

The published image SHALL support both `linux/amd64` and `linux/arm64` architectures in a single multi-arch manifest.

#### Scenario: Image runs on x86_64
- **WHEN** a user pulls the image on an `linux/amd64` host
- **THEN** Docker SHALL select the amd64 variant

#### Scenario: Image runs on ARM64
- **WHEN** a user pulls the image on an `linux/arm64` host
- **THEN** Docker SHALL select the arm64 variant

### Requirement: Authentication uses GITHUB_TOKEN

The workflow SHALL authenticate to GHCR using the built-in `GITHUB_TOKEN` with `packages: write` permission.

#### Scenario: Successful authentication
- **WHEN** the workflow runs
- **THEN** the `docker/login-action` SHALL use `${{ secrets.GITHUB_TOKEN }}` as the password
- **THEN** the push SHALL succeed without manual token configuration

### Requirement: Build caching

The workflow SHALL use GitHub Actions cache to accelerate subsequent builds.

#### Scenario: Cache hit reduces build time
- **WHEN** the workflow runs after a previous successful build
- **THEN** `docker/build-push-action` SHALL restore layers from `type=gha` cache
- **THEN** unchanged layers SHALL NOT be rebuilt

### Requirement: Docker persists self-hosted data
The container image SHALL use `/data` as `SIFT_DATA_DIR` and SHALL declare `/data` as a volume. The image SHALL run the Bun server.

#### Scenario: Container is recreated with a named volume
- **WHEN** the container is recreated with the same `/data` volume
- **THEN** sync and polling database files SHALL remain available
