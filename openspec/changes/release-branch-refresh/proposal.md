# Refresh existing automated release branches

The release workflow can fail when a second feature PR merges while an automated release PR for the same version is already open. It tries to create the same protected release branch from a newer base, which Git rejects as a non-fast-forward update. The open release PR then remains behind `main`, and later release attempts fail the same way.

Update the release workflow to reuse its existing branch, merge the latest `main` into it under the workflow's authorized identity, retain the generated version bump, and reuse the existing PR. This keeps the branch protected while allowing the normal CI, auto-merge, tag, and publish sequence to complete.
