-- Add tags support to feeds table for cross-device sync.
-- Tags are stored as JSON TEXT (string array); null means no tags.
ALTER TABLE feeds ADD COLUMN tags TEXT;
ALTER TABLE feeds ADD COLUMN tags_at INTEGER;
