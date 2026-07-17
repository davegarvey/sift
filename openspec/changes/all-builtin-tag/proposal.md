## Why

The sidebar currently has two mechanisms for showing everything: the "All Feeds" row and the implicit default state when no tag is active. Tags provide a clean scoping model, but "All Feeds" sits outside that model as a special-case row. Making "all" a built-in tag unifies the navigation around a single concept — a tag scopes your view, and "all" is the default scope — while removing visual clutter.

## What Changes

- Introduce `all` as a reserved, always-available built-in tag
- Remove the "All Feeds" row from the sidebar
- Always show the tag chips area in the sidebar (currently hidden when no user tags exist), with `all` as the first pinned chip
- The `all` tag shows all items (identical behaviour to current "All Feeds")
- Prevent users from creating or assigning a tag named `all` **BREAKING**

## Capabilities

### New Capabilities
- `builtin-all-tag`: The `all` builtin tag — its semantics, reserved status, and how it replaces "All Feeds"

### Modified Capabilities
- *(none — no existing specs to modify)*

## Impact

- **src/components/Sidebar.tsx**: Remove "All Feeds" row; always show tag chips with `all` pinned first; guard against creating `all` in tag input
- **src/components/TagInput.tsx**: Reject `all` as a tag name (inline validation + prevent autocomplete selection)
- **src/components/AddFeedModal.tsx**: Inherits TagInput validation
- **src/components/FeedEditorModal.tsx**: Inherits TagInput validation
- **src/state.tsx**: No state model changes — `all` maps to the existing `riverScope === null && activeTags.length === 0` state
- **src/styles.css**: Remove `.all-feeds` styles if they exist; tag chips area always visible
