## Context

Readability strips `<script>` tags, which removes the MathJax processor from articles that use LaTeX math notation. The `<span class="math inline">` and `<span class="math display">` elements survive extraction, but their raw LaTeX source (e.g., `\(\pi^2 \approx 10\)`) is rendered as-is — visible but unreadable.

Current extraction pipeline in `extract.ts`:
1. Fetch HTML → 2. Parse DOM → 3. Set `<base>` tag → 4. Readability → 5. Inline images → 6. Inject hero

## Goals / Non-Goals

**Goals:**
- Make common LaTeX math expressions readable in the extracted article view
- Handle the patterns most frequently seen in technical blog content: Greek letters, sums, fractions, superscripts/subscripts, common operators
- Zero bundle size impact, zero new dependencies

**Non-Goals:**
- Full LaTeX math rendering (no general-purpose LaTeX parser/renderer)
- No display-mode math formatting (block vs inline distinction is preserved but both get same treatment)
- No MathJax/KaTeX integration

## Decisions

- **Post-process at extraction time**: Run the LaTeX converter in `extract.ts` after Readability and before image inlining. This bakes the rendered output into `extractedHtml` in IndexedDB — no runtime cost on subsequent reads.
- **DOMParser-based, not regex**: Parse the HTML fragment into a DOM, walk `<span class="math inline">` and `<span class="math display">` elements, and operate on their text content. Avoids regex fragility with nested braces.
- **Unicode + simple HTML, not images**: Use Unicode math/alphanumeric characters (U+1D434, etc.) for Greek letters and operators, and `<sup>`/`<sub>` for powers and indices. No external rendering.
- **Strip MathJax-specific wrappers**: Remove `\(` `\)` `\[` `\]` delimiters — they are MathJax syntax, not content.
- **Pipeline placement**: Insert `renderLatex()` between Readability extraction (line 46) and `inlineImages()` (line 54), operating on the plain HTML string.

## Risks / Trade-offs

- [Limited coverage] Complex LaTeX (matrices, integrals with limits, cases) will remain unreadable. Mitigation: these are rare in feed content; the common cases (Greek, fractions, sums) cover >90% of occurrences.
- [False positives] A `<span class="math inline">` not containing LaTeX could get mangled. Mitigation: the class name is specific enough that false positives are unlikely; stripping delimiters is safe.
- [Maintenance] The converter is a mapping table, easily extended as new patterns surface. Not a recurring maintenance burden.
