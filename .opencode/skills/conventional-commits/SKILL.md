---
name: conventional-commits
description: Use Conventional Commits format when writing commit messages. Apply before every commit.
---

Always use the Conventional Commits format when writing commit messages.

Format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

- Scope is optional (e.g. `feat(sidebar):`, `fix(river):`)
- Description is lowercase, imperative mood, no period
- Use `feat` for new features, `fix` for bug fixes
- Breaking changes: append `!` after type/scope (e.g. `feat!: drop legacy API`)
