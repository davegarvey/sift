## Context

The focus-mode button already exposes its state through `aria-pressed` and changes its tooltip when toggled. Reader toolbar controls currently use a neutral surface/foreground treatment for hover and keyboard focus.

## Goals / Non-Goals

**Goals:**

- Keep the enabled treatment visible when the control is idle.
- Reuse the existing theme palette and button-state styling.

**Non-Goals:**

- Change focus-mode behavior, persistence, or tooltip wording.
- Introduce a new accent color or additional component state.

## Decisions

Use the existing pressed state as the source of truth and apply the toolbar's neutral surface background and primary text color while pressed. This avoids duplicating state in the component and makes the highlight persist independently of hover/focus. Do not use the mauve accent, which is reserved for unread and selection cues.

**Alternative considered:** Add a separate state class or a new color token. Both would duplicate an existing state signal or add theme complexity without improving the interaction.

## Risks / Trade-offs

- The active and hovered states share the same neutral treatment → The enabled background remains present at rest, so the state is still distinguishable from the unpressed idle control.
