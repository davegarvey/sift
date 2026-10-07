## ADDED Requirements

### Requirement: Static information pages are available to visitors

The hosted site SHALL serve crawlable About, Privacy and Terms pages at `/about`, `/privacy` and `/terms`. Each page SHALL work in the Workers, Node, Bun and Vite development adapters and provide navigation back to the reader. The service worker SHALL NOT replace navigation to these routes with the reader app shell.

#### Scenario: Visitor opens a public information page

- **WHEN** a visitor navigates directly to `/about`, `/privacy` or `/terms`
- **THEN** the server SHALL return the matching HTML document without first loading the SolidJS reader
- **AND** the page SHALL include a link back to `/`

#### Scenario: Installed reader opens a public information page

- **WHEN** an installed reader navigates to `/about`, `/privacy` or `/terms`
- **THEN** the service worker SHALL allow the request to reach the matching static page

#### Scenario: Legal pages are ready to publish

- **WHEN** Privacy and Terms are deployed
- **THEN** their storage, deletion, retention, provider and proxy statements SHALL match the implementation
- **AND** both SHALL include the operator's real forwarding contact address
