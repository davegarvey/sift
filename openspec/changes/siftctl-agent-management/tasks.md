## 1. Feed Metadata Plumbing

- [x] 1.1 Extend the CLI feed parser with best-effort title and HTML URL discovery while preserving successful add behavior when discovery fails
- [x] 1.2 Add shared feed URL validation and browser-compatible tag normalization for CLI inputs
- [x] 1.3 Update feed push construction so add preserves discovered/explicit metadata and edit sends only requested fields

## 2. CLI Commands

- [x] 2.1 Add `feed edit <url> --title` and `--tags` with exact live-feed resolution, clearing support, and unknown-feed errors
- [x] 2.2 Update `feed add` and `feed remove` to validate URLs, reject unknown removals, and reject unexpected arguments
- [x] 2.3 Add `--json` results and strict argument parsing for feed mutations and `mark read`
- [x] 2.4 Resolve synchronized feed IDs for paired `items` calls so emitted IDs target browser-created subscriptions

## 3. Tests And Documentation

- [x] 3.1 Add unit coverage for metadata discovery, explicit metadata precedence, tag normalization, edit payloads, and safe removal
- [x] 3.2 Add unit coverage for synchronized item IDs, public URL fallback, JSON mutation results, and argument validation
- [x] 3.3 Update the CLI README usage, command examples, and JSON output contract

## 4. Verification

- [x] 4.1 Run OpenSpec validation and mark the implementation tasks complete
- [x] 4.2 Run focused siftctl tests, typecheck, lint, and the workspace build
