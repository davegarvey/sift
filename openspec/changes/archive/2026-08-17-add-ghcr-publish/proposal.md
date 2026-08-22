## Why

Sift has a Dockerfile for self-hosted deployment but no automated CI/CD pipeline to publish container images. Adding GHCR publishing lets users deploy Sift via `docker pull ghcr.io/<owner>/sift` without building from source.

## What Changes

- Add a GitHub Actions workflow that builds the Docker image and pushes it to GitHub Container Registry
- Build multi-arch images (`linux/amd64` + `linux/arm64`) in a single step
- Tag images with branch, semver tag, and short SHA
- Trigger on push to `main`, version tags (`v*.*.*`), and manual dispatch

## Capabilities

### New Capabilities
- `ghcr-publish`: Automated container image publishing to GitHub Container Registry

### Modified Capabilities

None.

## Impact

- New file: `.github/workflows/publish-ghcr.yml`
- No changes to existing code, APIs, or dependencies
- Requires `GITHUB_TOKEN` with `packages: write` permission (default for repo-scoped tokens)
