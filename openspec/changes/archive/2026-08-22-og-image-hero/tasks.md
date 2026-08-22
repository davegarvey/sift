## 1. Implement OG image hero fallback

- [x] 1.1 In `extractArticle`, query `<meta property="og:image">` BEFORE Readability (it strips <head>), save URL to `ogUrl`
- [x] 1.2 Wire up the three-tier fallback: `ogUrl` → feed `thumbnailUrl` → no hero
- [x] 1.3 `injectHeroImage` already accepts any image URL — no signature change needed
- [x] 1.4 In `openItemForReading` Path 2, detect cached HTML whose hero image came from the feed thumbnail (`data-original-src` matches `item.thumbnail`) and clear cache to force re-extraction with OG image

## 2. Verify

- [x] 2.1 Run `npm run typecheck` — zero errors
- [ ] 2.2 Run `npm run lint` — zero new warnings (pre-existing error in `.opencode/plugins/crit.ts`)
- [x] 2.3 Run `npm test` — all 18 tests pass
- [ ] 2.4 Run `npm run dev` and verify hero image quality improves on a video article
