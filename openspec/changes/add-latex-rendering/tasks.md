## 1. Implement the LaTeX converter

- [ ] 1.1 Create `renderLatex()` function in `extract.ts` with a lookup table for common LaTeX commands (Greek letters, operators, etc.)
- [ ] 1.2 Implement brace-aware parser for `\frac{num}{den}`, superscript (`^`), and subscript (`_`) notation
- [ ] 1.3 Handle MathJax delimiters: strip `\(` `\)` `\[` `\]`, strip `\left`/`\right`, strip grouping braces
- [ ] 1.4 Wire `renderLatex()` into the extraction pipeline after Readability and before image inlining
- [ ] 1.5 Add test cases covering the scenarios from the spec (Greek letters, fractions, superscripts, operators, delimiters, unknown commands, non-math content)
