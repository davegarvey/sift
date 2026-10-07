## Workflow

- [ ] Fetch and base version calculation on the current `main`.
- [ ] Reuse an existing release branch by merging current `main` into it, preserving its release version, and push as a fast-forward.
- [ ] Reuse the existing release PR or create one when none exists.

## Verification

- [ ] Validate the OpenSpec change strictly.
- [ ] Verify workflow syntax and the release branch refresh path.
- [ ] Confirm the existing release PR updates and completes CI/auto-merge after this workflow change lands.
