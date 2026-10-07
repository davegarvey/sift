## Why

The release workflow failed when a second feature PR merged while an automated release PR for the same version was already open. It tried to create the same protected release branch from a newer base, which Git rejected as a non-fast-forward update. The open release PR then remained behind `main`, and later release attempts failed the same way.

## What Changes

- Update the release workflow to reuse an existing branch and merge the latest `main` into it under the workflow's authorized identity.
- Retain the generated version bump and reuse the existing PR.
- Preserve protected branch history while allowing normal CI, auto-merge, tag and publish steps to complete.
