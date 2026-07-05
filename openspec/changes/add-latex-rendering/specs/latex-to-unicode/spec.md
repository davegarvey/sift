## ADDED Requirements

### Requirement: Convert inline math elements to readable text

The extraction pipeline SHALL post-process HTML content to convert LaTeX math expressions inside `<span class="math inline">` and `<span class="math display">` elements into readable Unicode text and simple HTML formatting.

#### Scenario: Inline math with Greek letters
- **WHEN** the article HTML contains `<span class="math inline">\( \pi \)</span>` or `<span class="math inline">\( \tau \)</span>`
- **THEN** the extracted output SHALL contain `π` or `τ` respectively, not the raw LaTeX

#### Scenario: Display math with fractions
- **WHEN** the article HTML contains `<span class="math display">\[\frac{a}{b}\]</span>`
- **THEN** the extracted output SHALL render the fraction using superscript and subscript notation, e.g., `<sup>a</sup>⁄<sub>b</sub>`

#### Scenario: Square and power notation
- **WHEN** the article HTML contains `<span class="math inline">\(\pi^2\)</span>`
- **THEN** the extracted output SHALL render `π` followed by `<sup>2</sup>`

#### Scenario: Subscript notation
- **WHEN** the article HTML contains `<span class="math inline">\(x_n\)</span>`
- **THEN** the extracted output SHALL render `x` followed by `<sub>n</sub>`

#### Scenario: Common operators render as Unicode
- **WHEN** the article HTML contains `\sum`, `\infty`, `\approx`, `\le`, `\ge`, `\rightarrow`, `\cdot`, `\times`, `\mathcal`
- **THEN** the extracted output SHALL contain the corresponding Unicode character (∑, ∞, ≈, ≤, ≥, →, ·, ×, 𝒪 respectively)

#### Scenario: Math delimiters are removed
- **WHEN** the article HTML contains `\(` or `\)` or `\[` or `\]` delimiters
- **THEN** the extracted output SHALL NOT contain these delimiter strings

#### Scenario: `\left` and `\right` commands are removed
- **WHEN** the article HTML contains `\left(` or `\right)`
- **THEN** the extracted output SHALL contain just `(` or `)` without the LaTeX command

#### Scenario: Grouping braces are removed
- **WHEN** the article HTML contains `{` and `}` used as LaTeX grouping
- **THEN** the extracted output SHALL NOT contain these braces

#### Scenario: Nested braces in commands
- **WHEN** the article HTML contains `\frac{\tau r^2}{2}`
- **THEN** the converter SHALL correctly handle nested braces and produce the appropriate superscript/subscript output

#### Scenario: Unknown LaTeX commands pass through as text
- **WHEN** the article HTML contains a LaTeX command not in the conversion table (e.g., `\unknown`)
- **THEN** the command SHALL be left as-is in the output, preserving the raw text

#### Scenario: Non-math content is untouched
- **WHEN** the article HTML contains `<span>` elements without `math` in their class
- **THEN** the converter SHALL NOT modify them
