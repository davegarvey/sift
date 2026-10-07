# AGENTS.md — Commands and conventions for this repo

Sift — a simple, slick, browser-first RSS reader.

## Build / lint / test / deploy commands

- `npm run dev` — start Vite dev server (with HMR and the Hono proxy mounted as middleware) on http://localhost:8787
- `npm run build` — produce `dist/` containing the static bundle
- `npm start` — start the production node server (serves `dist/` and the proxy)
- `npm run typecheck` — `tsc --noEmit` (zero errors required)
- `npm run lint` — `eslint . --max-warnings=0`
- `npm test` — `vitest run`
- `npm run spec:validate` — strict validation of the main specs in `openspec/specs/` (runs in CI)
- `npm run deploy` — `git pull --ff-only && vite build && wrangler d1 migrations apply sift-sync --remote && wrangler d1 migrations apply sift-poll --remote && wrangler deploy` (always deploy via this script — it pulls the latest before building and applies both D1 databases' migrations before the deploy). `npm run deploy:ci` is the same sequence without `git pull`, used as the Workers Builds deploy command.

## Architecture

- The browser handles feed parsing and reading; the server proxies upstream requests, stores sync state in D1, and can poll synced feeds on Workers.
- Server entry: `server/handle.ts` (shared Hono app). Adapters: `server/node.ts`, `server/bun.ts`, `server/worker.ts`.
- Three proxy endpoints: `GET /feed?url=`, `GET /article?url=`, `GET /img?url=`. Forward `If-None-Match` / `If-Modified-Since`; never log upstream URLs.
- Storage: IndexedDB via the `idb` wrapper. Types live in `src/db/types.ts`; the schema and its upgrade handler live in `src/db/open.ts`. Article records (`items`) hold metadata only. Bodies (`html` from the feed, `extractedHtml` from Readability) live in the `itemBodies` store, keyed by article ID and read only by `openItemForReading`; `bulkUpsertItems` takes an `ItemInput` and splits the body on write. Version 11 tracks `lastSeenAt` for bounded age-based cleanup: version 10 is migrated in place, version 9 is upgraded once by stripping bodies from article records with a cursor (bodies are dropped, not moved, because copying them took about 2.5 times as long; they return on the next refresh or the next online open), and anything older is deleted and recreated empty. A newer version closes and reloads tabs that hold the database (`blocking`), a blocked open (`blocked`) and a running upgrade set a status in `src/db/open.ts` that changes the river's loading message.
- UI: SolidJS. Vue/React-free. JSX with `jsxImportSource: solid-js`.
- Styling: plain CSS keyed off Catppuccin Latte (light) / Mocha (dark). Reserve the Catppuccin Mauve accent for unread + selection only.
- Article extraction: `@mozilla/readability` against the `/article?url=` proxy. Extracted HTML keeps images as `/img?url=` proxy URLs, which the browser caches for 30 days, rather than inlining them. Extractions are stored in `itemBodies`; unstarred bodies are removed after 90 days unseen, and unstarred unread records after 365 days unseen. Read and starred records remain.
- Server-side feed polling uses a separate `sift-poll` D1 binding (`POLL_DB`) and migrations in `server/migrations-poll/`; it is enabled only when `FEED_POLLING = "true"` and the binding exists. It retains items for 7 days, polls at most 500 feeds per account, and pauses above `POLL_DB_MAX_BYTES` (8 GiB by default). Polling stores complete feed URLs, including credentials embedded in private-feed URLs.

## Conventions

- Strict TypeScript everywhere. No `any` without a comment explaining why.
- This is a forward-facing PWA: clients update automatically, so do not add legacy-client compatibility paths unless required by persisted data, shipped behavior, or an external consumer. Prefer moving current data forward over supporting obsolete clients.
- Code style: no comments unless asked. Match existing patterns in the file you're editing.
- Test files live alongside source where appropriate (`*.test.ts`) or under `tests/` for integration tests.
- The `LICENSE` is MIT. Do not introduce third-party code that is incompatible.
- **Use Lucide icons.** Every icon should come from `lucide-solid`. No raw SVG, no Unicode/emoji glyphs, no plain-text `+` or similar — always use the corresponding Lucide component with the `size` prop for consistent visual weight.
- **README freshness.** If your change adds, removes, or modifies a feature the README describes (deploy targets, architecture, scripts, known limitations, configuration, etc.), update the README in the same PR. Search README for keywords related to your change to find stale text.
- **Version bumps are automated.** The release workflow handles version bumps, release branch creation, and tag pushes. Never run `grubble` locally or ask an AI agent to bump the version. Doing so will collide with the automated pipeline and create duplicate commits/PRs.
- **Release refs are protected.** GitHub rulesets protect `release/v*` branches and `v*.*.*` tags; only the release workflow's `RELEASE_PAT` identity may create or update them.

## Git workflow

- **Never push directly to `main`.** Create a feature branch (e.g., `feat/short-description`, `fix/short-description`), push it, and open a PR. PRs are how changes land on `main` — even for one-commit changes.
- Before branching, from the repository root worktree, switch to `main` and update it with `git pull --ff-only`.
- Use `./.worktrees/<task-slug>` for new feature work so multiple agents can work in parallel. From the repository root worktree, create each task's isolated checkout with `git worktree add -b <type>/<task-slug> .worktrees/<task-slug> main`, then run all task commands from that worktree.
- Every agent must use a unique worktree path and branch. Do not edit the repository root for feature work, share a worktree with another agent, or check out a branch already attached to another worktree. Worktree isolation prevents checkout collisions but does not prevent merge conflicts.
- Confirm the active checkout with `git worktree list` before editing. After a branch is merged and no agent is using it, remove it from the repository root with `git worktree remove .worktrees/<task-slug>` and clear stale metadata with `git worktree prune`.
- Use conventional commits for commit messages. Include the PR number in the body if applicable.

## OpenSpec

Each change lives in `openspec/changes/<change>/`: `proposal.md` (the why), `specs/` (the WHAT, as deltas against `openspec/specs/`), `design.md` (the HOW) and `tasks.md`. Several changes may be in progress at once; list them with `openspec list`.
A change may start as a proposal alone. Add its specs and tasks before implementation, include the change in the implementing PR, and run `openspec validate <change> --strict`. After merge, archive it into `openspec/changes/archive/` so its deltas update `openspec/specs/`.

If implementation requires a spec deviation, update the relevant spec or design artifact AND mention the divergence in the task summary.
