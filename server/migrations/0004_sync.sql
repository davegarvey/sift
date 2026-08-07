-- Sync-key rotation: the old key is permanently dead after regeneration.
-- Master-key auth and agent-token auth reject rotated rows, and /sync/register
-- refuses to resurrect them. NULL = live key.
ALTER TABLE users ADD COLUMN rotated_at INTEGER;
