## Workflow

- [x] Fetch and base version calculation on the current `main`.
- [x] Reuse an existing release branch by merging current `main` into it, preserving its release version, and push as a fast-forward.
- [x] Reuse the existing release PR or create one when none exists.

## Verification

- [x] Validate the OpenSpec change strictly.
- [x] Verify workflow syntax and the release branch refresh path.
- [x] Confirm the existing release PR updates and completes CI/auto-merge after this workflow change lands.
