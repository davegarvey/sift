## MODIFIED Requirements

### Requirement: River restores focus to previously viewed item
When returning to the river, the app SHALL restore focus to the previously opened article if it remains eligible. If Unread mode excludes that article because it is read, focus SHALL move to the next remaining article in the previously displayed order, or the previous remaining article when no next article exists. An empty list SHALL have no focused article. All mode SHALL preserve restoration to the opened article. Other missing-item cases SHALL preserve existing behaviour without focusing an unrelated filtered-out item.

#### Scenario: Return in All mode
- **WHEN** the reader returns from an article still eligible in All mode
- **THEN** focus SHALL return to that article at its current index

#### Scenario: Return in Unread mode
- **WHEN** the reader returns from an article excluded because it is now read
- **THEN** focus SHALL move to the next remaining article, falling back to the previous remaining article
- **AND** that article SHALL be brought into view

#### Scenario: Read the last unread article
- **WHEN** no eligible article remains after returning
- **THEN** the app SHALL clear article focus and show the appropriate empty state

#### Scenario: User opens article via click and returns
- **WHEN** the reader clicks an article and returns to the river
- **THEN** focus SHALL return to that article if eligible, otherwise follow the remaining-neighbour rule

#### Scenario: User opens article via keyboard and returns
- **WHEN** the reader opens a focused article with Enter and returns
- **THEN** focus SHALL return to that article if eligible, otherwise follow the remaining-neighbour rule

#### Scenario: Item no longer exists on return
- **WHEN** the article no longer exists because it was evicted or its feed removed
- **THEN** existing missing-item behaviour SHALL be preserved, with no focused article when the list is empty

#### Scenario: Item appears at different index on return
- **WHEN** the previously opened article remains eligible but its index has changed
- **THEN** focus SHALL use its new index in the eligible list
