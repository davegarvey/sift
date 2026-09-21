## Context

The focus-mode toggle already exposes its state through `aria-pressed`. Its active state currently uses a neutral surface fill, while toolbar hover and keyboard focus also use that fill.

## Goals / Non-Goals

**Goals:**

- Use the icon foreground as the persistent active cue.
- Keep the resting button background neutral and retain transient hover/focus feedback.

**Non-Goals:**

- Change focus-mode behavior, accessibility semantics, persistence, or tooltip wording.
- Add new palette tokens or alter other toolbar controls.

## Decisions

Use the existing high-contrast accent foreground token for the pressed toggle, without setting its background. The token is pink-tinted in the dark theme and adapts to the light theme; the existing toolbar hover/focus rules can still add their transient surface background without obscuring the active foreground tint.

**Alternative considered:** Use a dedicated new pink token. That would add palette maintenance for one state when the existing semantic accent foreground already adapts to both themes.

## Risks / Trade-offs

- The tint is more saturated than the neutral toolbar foreground → Restrict it to the single active focus-mode icon, leaving other controls unchanged.
