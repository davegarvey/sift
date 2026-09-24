## MODIFIED Requirements

### Requirement: Keep internal cache policy separate from browser policy

The representation stored in the Worker Cache API SHALL carry enough metadata to reconstruct `Age`, ETag, Last-Modified and the time at which the representation stops being fresh. Its Cache API lifetime SHALL cover the freshness lifetime plus the 24-hour retention window. The externally returned `/feed` response SHALL retain Sift's `Cache-Control: no-cache, no-store` policy.

#### Scenario: Cache API expiry is independent of browser caching

- **WHEN** a Worker stores a successful feed representation
- **THEN** the Worker Cache API representation SHALL remain available until 24 hours after its freshness ends
- **AND** the response returned to the browser SHALL not become a browser-persistent shared cache entry solely because of the internal cache policy

#### Scenario: Cache age is restored after in-memory loss

- **WHEN** a cached representation is read from the Worker Cache API after the in-memory state was lost
- **THEN** the proxy SHALL derive its cache age and freshness from stored metadata
- **AND** the returned response SHALL expose the same non-authoritative cache diagnostics as an in-memory hit

#### Scenario: Entry without freshness metadata

- **WHEN** a Worker Cache API entry lacks freshness metadata
- **THEN** the proxy SHALL treat it as a miss
