-- Last /sync/pull time (epoch seconds, written at most hourly). Server-side
-- feed polling only polls subscriptions of recently active accounts.
ALTER TABLE users ADD COLUMN last_active_at INTEGER;
