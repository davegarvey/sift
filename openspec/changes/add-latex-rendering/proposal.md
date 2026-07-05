## Why

Articles using MathJax/LaTeX for math expressions render raw source code (e.g., `\(\pi^2 \approx 10\)`) instead of formatted output, because Readability strips the MathJax script. This is a common pattern in technical blogs and HN articles.

## What Changes

- Post-process extracted article HTML to convert common LaTeX constructs to Unicode and simple HTML, so math expressions are readable without a full math rendering engine
- Add no new runtime dependencies; keep the solution under ~30 lines of code

## Capabilities

### New Capabilities
- `latex-to-unicode`: Convert common LaTeX commands (`\pi`, `\sum`, `\frac`, etc.) to Unicode equivalents and simple HTML formatting during article extraction

### Modified Capabilities
*(none)*

## Impact

- **`src/articles/extract.ts`**: Add a `renderLatex(html: string): string` function called after Readability extraction and before image inlining
- **No new dependencies, no bundle size increase, no server-side changes**
