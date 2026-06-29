## Context

The existing reader has an `IntersectionObserver`-based feature that auto-marks river items as read after they scroll past and were "seen." This is controlled by a `markReadOnScrollPast` toggle (default ON) in Settings. Users find this behavior surprising — items disappear from the river without explicit action.

The codebase already has the PR (#3) applied, so this design document serves as the retrospective record of what was removed and why.

## Goals / Non-Goals

**Goals:**
- Remove the IntersectionObserver-based scroll-past mark-read logic from `River.tsx`
- Remove the `markReadOnScrollPast` setting from schema, state, and persistence
- Remove the Settings UI toggle for the feature
- Preserve the explicit mark-read-on-open behavior when a user opens an item in reading view

**Non-Goals:**
- No change to the swipe-right gesture (which also marks items read — that's explicit user intent)
- No change to the manual read-toggle on hover
- No change to the mark-read-on-open behavior in `state.tsx:openItem`

## Decisions

### D1: Complete removal over toggling default to false

The feature had a Settings toggle, but the complexity of maintaining the `IntersectionObserver` infrastructure (observer setup, `hasBeenSeen` tracking, `leaveTimers`, 1-second polling interval for re-sync, `onCleanup` disposal) isn't justified for a feature users didn't want — even off by default. Removing it entirely eliminates ~70 lines of code and removes a source of confusion (the "Behavior" section in Settings with a single toggle).

### D2: On-open mark-read stays unchanged

The `openItem` function in `state.tsx` marks items read immediately when opened in reading view. This is explicit user intent (clicking or tapping an item) and is not related to the scroll-past behavior. It remains untouched.

### D3: Legacy settings key survives in schema

The `markReadOnScrollPast` field is removed from the `AppSettings` interface and `DEFAULT_SETTINGS`, but persisted settings objects in IndexedDB may still carry it. Old keys are silently ignored during deserialization via spread (`{ ...DEFAULT_SETTINGS, ...stored }`), so no migration is needed.

## Risks / Trade-offs

- **[Risk] User who customized the toggle**: The setting was default ON. A user who explicitly turned it OFF will find the toggle gone on upgrade. Since the feature is removed entirely, the state they wanted (scroll-past NOT marking read) is now the universal behavior — no regression.
- **[Risk] Reintroduction cost**: If a future version wants scroll-past mark-read back, the code must be rewritten from scratch (or resurrected from git history). Acceptable — the removal was clean and the git history preserves the old implementation.
- **[Trade-off] Single-item Behavior group in Settings**: The Behavior section in Settings had only this one toggle. Removing it leaves Settings with just Appearance, Subscriptions, and About — which is cleaner.
