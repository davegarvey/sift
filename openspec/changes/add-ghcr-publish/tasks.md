## 1. Create workflow file

- [x] 1.1 Create `.github/workflows/publish-ghcr.yml` with QEMU, Buildx, and login steps
- [x] 1.2 Add `docker/metadata-action` for tag generation (branch, semver, SHA)
- [x] 1.3 Add `docker/build-push-action` with `platforms: linux/amd64,linux/arm64` and GHA cache
- [x] 1.4 Verify `GITHUB_TOKEN` has `packages: write` permission on the job
