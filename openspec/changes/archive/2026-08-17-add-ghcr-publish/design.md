## Context

Sift has a multi-stage Dockerfile that builds static assets with Node and serves with Bun. Currently there's no CI pipeline to publish container images. The proposal adds a GitHub Actions workflow to publish multi-arch images to GHCR.

## Goals / Non-Goals

**Goals:**
- Automatically build and publish container images on push to `main` and version tags
- Support `linux/amd64` and `linux/arm64` platforms in a single multi-arch manifest
- Tag images with branch name, semver tag, and short commit SHA
- Use GitHub's built-in `GITHUB_TOKEN` for registry authentication

**Non-Goals:**
- Docker Hub or other registry publishing
- Building on PRs or branches other than `main` (beyond what's needed for verification)
- Container image scanning or SBOM generation
- Deploying the container — this is publish-only

## Decisions

1. **Single buildx command vs matrix**: Use a single `docker buildx build --platform` invocation rather than a matrix with separate platform jobs + manifest merge. The single-command approach is simpler, produces an atomic multi-arch manifest, and avoids intermediate platform tags cluttering the registry. The build time penalty (~2x sequential) is acceptable for this project's frequency.

2. **`GITHUB_TOKEN` vs dedicated PAT**: Use the built-in `GITHUB_TOKEN` with `packages: write` permission. No secret management needed, and the token is scoped to the repo. A PAT would be required only if another workflow or external system needed to push on the repo's behalf.

3. **Tags strategy**: Use `docker/metadata-action` with `type=ref,event=branch` (produces `main`), `type=ref,event=tag` (produces `v0.24.0`), and `type=sha,format=short` (produces `abc1234`). No `latest` tag — `main` serves as the rolling latest for users who want the edge, and `v*` tags are stable releases.

4. **Build cache**: Use `type=gha` (GitHub Actions cache) for both cache-from and cache-to with `mode=max`. This shares the layer cache across workflow runs, significantly speeding up rebuilds.

5. **QEMU + Buildx**: Use `docker/setup-qemu-action` for arm64 emulation and `docker/setup-buildx-action` for the multi-arch builder. Both base images (`node:22-slim` and `oven/bun:1.1-slim`) publish multi-arch manifests for amd64 and arm64.

## Risks / Trade-offs

- [Build duration] Multi-arch builds take ~2x wall-clock time since platforms are built sequentially. Mitigation: acceptable given infrequent pushes and GHA cache.
- [QEMU emulation performance] arm64 builds under QEMU emulation are slower than native arm64 runners. Mitigation: only affects the build stage; the resulting arm64 image is identical to a native build.
- [GHCR quota] Free GHCR storage and bandwidth are generous but not unlimited. Mitigation: Sift releases are infrequent; total image count will stay low.
