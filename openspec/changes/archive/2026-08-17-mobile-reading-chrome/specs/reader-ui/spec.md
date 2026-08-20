## MODIFIED Requirements

### Requirement: Mobile reading chrome SHALL use a bottom action bar
On mobile viewports (≤768px), reading view SHALL display a fixed bottom action bar containing, in order: prev (far left), star and open (central cluster), next (far right). The prev/next buttons SHALL use the same `hasPrev`/`hasNext` boundary logic as before — disabled/ghosted at first/last item and hidden when only one item exists. The top chrome SHALL NOT display prev/next chevrons on mobile.

#### Scenario: Bottom bar shows on mobile
- **WHEN** the user opens an article in reading view on a viewport ≤768px
- **THEN** a fixed bottom bar is visible with prev (far left), star, open, and next (far right) buttons

#### Scenario: Bottom bar not shown on desktop
- **WHEN** the user opens an article in reading view on a viewport >768px
- **THEN** the bottom action bar SHALL NOT be displayed, and the existing desktop chrome and margin chevrons remain

#### Scenario: Prev button ghosted at first item
- **WHEN** the user is reading the first item in the filtered results on mobile
- **THEN** the bottom-bar prev button is disabled and ghosted

#### Scenario: Next button ghosted at last item
- **WHEN** the user is reading the last item in the filtered results on mobile
- **THEN** the bottom-bar next button is disabled and ghosted

#### Scenario: Prev/next hidden for a single item
- **WHEN** the filtered results contain only one article
- **THEN** neither prev nor next SHALL appear in the bottom bar

#### Scenario: Bottom bar does not obscure article content
- **WHEN** the bottom bar is displayed on mobile
- **THEN** the reading body SHALL have sufficient bottom padding that the last paragraph is not permanently covered by the bar

### Requirement: Back CTA remains in the top-left chrome
Reading view SHALL keep a back button as the leftmost element of the top chrome on all viewports. It SHALL NOT move to the bottom bar.

#### Scenario: Back button in top chrome
- **WHEN** the user is in reading view on any viewport
- **THEN** a back button is displayed at the top-left of the reading chrome

#### Scenario: Back returns to the river
- **WHEN** the user activates the back button
- **THEN** the app returns to the river view, same as today

### Requirement: Help CTA is desktop-only
The keyboard-shortcuts help button in reading view SHALL be visible only on desktop viewports and SHALL NOT be displayed on mobile (≤768px) or on touch devices with coarse pointers at mobile widths.

#### Scenario: Help visible on desktop
- **WHEN** the user is in reading view on a viewport >768px
- **THEN** the help button is visible and opens the shortcuts overlay

#### Scenario: Help hidden on mobile
- **WHEN** the user is in reading view on a viewport ≤768px
- **THEN** the help button SHALL NOT be displayed, regardless of pointer type

#### Scenario: Help remains accessible via keyboard on desktop
- **WHEN** the user presses `?` in reading view on desktop
- **THEN** the shortcuts overlay opens as before

### Requirement: Mobile swipe navigation between articles
On touch devices, a horizontal swipe in the reading view SHALL navigate between articles: swipe left → next article, swipe right → prev article. The gesture SHALL NOT engage from vertical scrolling (dead zone before any visual shift, axis lock that bails when vertical motion dominates), SHALL NOT capture gestures starting in the screen-edge zones reserved for the browser's native back/forward swipe, SHALL NOT capture touches that begin on interactive or horizontally scrollable elements, and SHALL require the swipe to cross a commit threshold — otherwise the view snaps back without navigating.

#### Scenario: Swipe left opens the next article
- **WHEN** the user swipes left in the reading view past the commit threshold on a touch device
- **THEN** the reading view navigates to the next article

#### Scenario: Swipe right opens the previous article
- **WHEN** the user swipes right in the reading view past the commit threshold on a touch device
- **THEN** the reading view navigates to the previous article

#### Scenario: Sub-threshold swipe snaps back
- **WHEN** the user swipes horizontally in the reading view but releases before the commit threshold
- **THEN** the view snaps back to its resting position and no navigation occurs

#### Scenario: Vertical scroll does not trigger navigation
- **WHEN** the user scrolls the article vertically on a touch device
- **THEN** the gesture bails out before any horizontal displacement and no navigation occurs

#### Scenario: Edge-zone swipes are left to the browser
- **WHEN** a horizontal swipe starts within the screen-edge zones reserved for the browser's native back/forward gesture (left and right ~20-24px)
- **THEN** the reading view SHALL NOT capture the gesture
- **AND** the browser's native back/forward swipe behavior is unaffected

#### Scenario: Interactive elements are exempt
- **WHEN** the touch begins on a link, button, iframe, video, or a horizontally scrollable element (`pre`, overflow-x block)
- **THEN** the swipe gesture SHALL NOT be captured, and the element behaves natively

#### Scenario: Swipe does not navigate at boundaries
- **WHEN** the user is at the first item and swipes right, or at the last item and swipes left
- **THEN** no navigation occurs and the view snaps back

#### Scenario: Single item disables swipe
- **WHEN** the filtered results contain only one article
- **THEN** no swipe navigation is active
