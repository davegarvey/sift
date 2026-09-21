## MODIFIED Requirements

### Requirement: Focus-mode toggle visibly indicates the active state

The desktop focus-mode toggle SHALL indicate enabled mode with a persistent pink-tinted icon foreground, including when the control is neither hovered nor focused. While enabled at rest, the control SHALL retain its neutral toolbar background without a filled active highlight. When focus mode is disabled, the icon SHALL use its neutral idle color. Existing transient hover and keyboard-focus feedback SHALL remain available.

#### Scenario: Enabled toggle remains highlighted at rest

- **WHEN** focus mode is enabled and the toggle is neither hovered nor focused
- **THEN** the toggle icon displays a persistent pink-tinted foreground
- **AND** the button retains its neutral toolbar background

#### Scenario: Disabled toggle has no active highlight at rest

- **WHEN** focus mode is disabled and the toggle is neither hovered nor focused
- **THEN** the toggle icon displays its neutral idle color without an active background

#### Scenario: Active tint remains visible during hover and focus

- **WHEN** focus mode is enabled and the toggle is hovered or keyboard-focused
- **THEN** the pink-tinted icon remains visible
- **AND** the existing transient hover or focus treatment remains available
