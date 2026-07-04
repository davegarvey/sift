# AGENTS.md — Commands and conventions for this repo

Sift — a simple, slick, browser-first RSS reader.

## Build / lint / test / deploy commands

- `npm run dev` — start Vite dev server (with HMR and the Hono proxy mounted as middleware) on http://localhost:8787
- `npm run build` — produce `dist/` containing the static bundle
- `npm start` — start the production node server (serves `dist/` and the proxy)
- `npm run typecheck` — `tsc --noEmit` (zero errors required)
- `npm run lint` — `eslint . --max-warnings=0`
- `npm test` — `vitest run`
- `npm run deploy` — `git pull && vite build && wrangler deploy` (always deploy via this script — it pulls the latest before building)

## Architecture

- The browser does everything; the server is a stateless pipe.
- Server entry: `server/handle.ts` (shared Hono app). Adapters: `server/node.ts`, `server/bun.ts`, `server/worker.ts`.
- Three proxy endpoints: `GET /feed?url=`, `GET /article?url=`, `GET /img?url=`. Forward `If-None-Match` / `If-Modified-Since`; never log upstream URLs.
- Storage: IndexedDB via the `idb` wrapper. Schema lives in `src/db/types.ts`.
- UI: SolidJS. Vue/React-free. JSX with `jsxImportSource: solid-js`.
- Styling: plain CSS keyed off Catppuccin Latte (light) / Mocha (dark). Reserve the Catppuccin Mauve accent for unread + selection only.
- Article extraction: `@mozilla/readability` against the `/article?url=` proxy. Images inlined as `data:` URIs (via `/img?url=`) and stored on the item record. Storage eviction: 7-day full retention, 30-day text-only, evict under storage pressure.

## Conventions

- Strict TypeScript everywhere. No `any` without a comment explaining why.
- Code style: no comments unless asked. Match existing patterns in the file you're editing.
- Test files live alongside source where appropriate (`*.test.ts`) or under `tests/` for integration tests.
- The `LICENSE` is MIT. Do not introduce third-party code that is incompatible.

## Git workflow

- **Never push directly to `main`.** Create a feature branch (e.g., `feat/short-description`, `fix/short-description`), push it, and open a PR. PRs are how changes land on `main` — even for one-commit changes.
- Before branching, ensure `main` is up to date with `git pull`.
- Use conventional commits for commit messages. Include the PR number in the body if applicable.

## OpenSpec

Change artifacts live in `openspec/changes/`. Current change: `add-core-reader`.
Specs (the WHAT) live in `openspec/changes/add-core-reader/specs/`. Design (the HOW) lives in `design.md`. Tasks are tracked in `tasks.md`.

If implementation requires a spec deviation, update the relevant spec or design artifact AND mention the divergence in the task summary.