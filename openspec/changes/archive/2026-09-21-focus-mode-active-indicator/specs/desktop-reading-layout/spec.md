## ADDED Requirements

### Requirement: Focus-mode toggle visibly indicates the active state

The desktop focus-mode toggle SHALL use a persistent visual highlight while focus mode is enabled, including when the control is neither hovered nor focused. When focus mode is disabled, the toggle SHALL use its neutral idle appearance. The active treatment SHALL use neutral theme colors rather than the reserved mauve unread/selection accent.

#### Scenario: Enabled toggle remains highlighted at rest

- **WHEN** focus mode is enabled and the toggle is neither hovered nor focused
- **THEN** the toggle displays its active visual highlight
- **AND** the focus-mode state remains clear without relying on the tooltip

#### Scenario: Disabled toggle has no active highlight at rest

- **WHEN** focus mode is disabled and the toggle is neither hovered nor focused
- **THEN** the toggle displays its neutral idle appearance without the active highlight
