## ADDED Requirements

### Requirement: Storage SHALL be local-only via IndexedDB
All application state — subscriptions, items, read/starred state, refresh metadata, app settings — SHALL persist to IndexedDB in the browser. No server-side persistence, no server-side database, no cloud sync SHALL exist in v0.

#### Scenario: User makes changes and closes the tab
- **WHEN** the user subscribes to feeds, reads items, or toggles stars and then closes the tab
- **THEN** all changes are persisted to IndexedDB and are present when the app is next opened

#### Scenario: User clears browser storage
- **WHEN** the user clears IndexedDB via browser settings
- **THEN** all application state is lost unless the user has backed up via OPML export
- **AND** no recovery mechanism exists beyond re-importing an OPML backup of the subscription list

### Requirement: Subscription list SHALL be exportable as OPML 2.0
The app SHALL export the user's subscription list (feeds and folder structure, not read/starred state) as a valid OPML 2.0 file downloadable by the user.

#### Scenario: User exports subscriptions
- **WHEN** the user invokes Export from settings
- **THEN** a valid OPML 2.0 file is generated containing the user's feeds and folders and is offered as a download

#### Scenario: Exported OPML contains nested folders
- **WHEN** the user has feeds organized into nested folders
- **THEN** the exported OPML nests `<outline>` elements to mirror the folder tree
- **AND** leaf outlines carry `xmlUrl`, `htmlUrl`, `text`, and `title` attributes

### Requirement: Subscription list SHALL be importable from OPML
The app SHALL accept an OPML file upload and merge its contents into the existing subscription list without destroying any existing data.

#### Scenario: User imports an OPML file
- **WHEN** the user selects an OPML file via the import affordance
- **THEN** the app parses the file and extracts every outline with an `xmlUrl`, preserving folder path from parent outlines

#### Scenario: Imported feed URL is already subscribed
- **WHEN** the user imports an OPML containing a feed URL already present in `feeds`
- **THEN** the existing feed record is preserved unchanged, including its `folder` (the imported folder is NOT applied), its refresh metadata, and any read/starred state on its items

#### Scenario: Imported feed URL is new
- **WHEN** the user imports an OPML containing a feed URL not present in `feeds`
- **THEN** the new feed is inserted into `feeds` with `folder` set from the OPML hierarchy

#### Scenario: Imported folder is new
- **WHEN** the user imports an OPML whose folder path does not match any existing folder in the user's data
- **THEN** the folder is created and the new feed is placed in it

### Requirement: Import shall be non-destructive and require confirmation
The app SHALL present a preview of the import result and SHALL apply changes only after the user confirms. Import SHALL never delete or overwrite existing data without explicit confirmation.

#### Scenario: Import preview is shown
- **WHEN** the app parses an OPML file and prepares to import
- **THEN** a preview is shown describing how many feeds will be added, how many will be skipped (already subscribed), and asking for confirmation

#### Scenario: User confirms import
- **WHEN** the user confirms an import preview
- **THEN** the app applies the merge: new feeds are inserted, existing feeds are skipped, folders are merged additively, and no existing data is destroyed

#### Scenario: User cancels import
- **WHEN** the user dismisses the import preview without confirming
- **THEN** no changes are made to the user's data

### Requirement: Feed identity for import merge SHALL be normalized URL
Import merge SHALL compare feeds by normalized URL (with query strings stripped for matching only; the original URL is stored and used for fetching). This prevents duplicate subscriptions when the same feed is referenced with different query parameters.

#### Scenario: Same feed imported with different query strings
- **WHEN** an OPML contains a feed URL `https://example.com/feed?utm_source=opml` and the user is already subscribed to `https://example.com/feed`
- **THEN** the importer recognizes the URL as already-subscribed after normalizing by stripping the query string
- **AND** the feed is skipped without duplication

### Requirement: Export/import covers only the subscription list, not item state
v0 export and import SHALL cover only the subscription list (feeds + folder structure). Read/starred state, item history, and refresh metadata SHALL NOT be included in OPML export or restored by OPML import.

#### Scenario: User exports and re-imports on a fresh device
- **WHEN** the user exports an OPML file on one device and imports it on another device with no other state
- **THEN** the subscription list is reproduced but no read/starred state or item history is transferred
- **AND** the new device begins fresh: all items arriving from the first refresh are unread

### Requirement: Subscription management SHALL be discoverable from settings
Import and export affordances SHALL be available in the settings drawer/modal, not as standalone buttons in the persistent chrome.

#### Scenario: User opens settings to import
- **WHEN** the user opens settings and selects Import
- **THEN** a file picker accepts an OPML file

#### Scenario: User opens settings to export
- **WHEN** the user opens settings and selects Export
- **THEN** an OPML file download is initiated immediately