## REMOVED Requirements

### Requirement: Eviction clears the earliest-opened articles first under storage pressure
**Reason**: Size-based eviction of `extractedHtml` no longer serves its purpose. Bodies are 5-20 KB with images kept as `/img` URLs, and age-based retention in `storage-retention` replaces it. Adapting it to the separate body store would maintain code that is about to be replaced.
**Migration**: None. Bodies are kept until `storage-retention` deletes them by age.

### Requirement: Soft cap is quota-aware
**Reason**: The soft cap existed only for eviction, which is removed.
**Migration**: None. `STORAGE_SOFT_CAP_RATIO` is deleted.

### Requirement: Eviction writes are batched in chunks
**Reason**: The chunked eviction pass is removed.
**Migration**: None. `EVICTION_CHUNK_SIZE` is deleted.

### Requirement: Eviction never drops item metadata
**Reason**: There is no eviction to constrain. Article records no longer hold bodies, so no storage operation clears a field of an article record.
**Migration**: None.
